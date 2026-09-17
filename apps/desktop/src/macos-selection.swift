import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

@main
enum MacosSelection {
  static func main() {
    let application = NSApplication.shared
    application.setActivationPolicy(.prohibited)
    let monitor = SelectionMonitor()
    monitor.start()
    emit(["type": "ready"])
    DispatchQueue.global(qos: .userInitiated).async {
      monitor.readCommands()
    }
    application.run()
  }
}

private let minDragPixels: CGFloat = 8
private let readDelayNs: UInt64 = 100_000_000
private let clipboardWaitNs: UInt64 = 20_000_000
private let clipboardDeadlineNs: UInt64 = 150_000_000
private let vkAnsiC: CGKeyCode = 8

private final class SelectionMonitor: @unchecked Sendable {
  private let lock = NSLock()
  private var excludePids: Set<pid_t> = [pid_t(getpid())]
  private var press: NSPoint?
  private var dragged = false
  private var eventMonitor: Any?
  // Posted clipboard-fallback Command+C keyDown events still to ignore.
  private var postedCommandCRemaining = 0

  func start() {
    let trusted = AXIsProcessTrustedWithOptions([
      kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: false,
    ] as CFDictionary)
    if !trusted {
      emit(["type": "untrusted"])
      return
    }
    let mask: NSEvent.EventTypeMask = [
      .leftMouseDown, .leftMouseUp, .leftMouseDragged,
      .rightMouseDown, .otherMouseDown, .scrollWheel, .keyDown,
    ]
    eventMonitor = NSEvent.addGlobalMonitorForEvents(matching: mask) { [weak self] event in
      self?.handle(event)
    }
  }

  func readCommands() {
    while let line = readLine(strippingNewline: true) {
      guard let data = line.data(using: .utf8),
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      else { continue }
      if object["type"] as? String == "exclude-pids", let values = object["pids"] as? [Any] {
        var next: Set<pid_t> = [pid_t(getpid())]
        for value in values {
          if let number = value as? NSNumber {
            next.insert(pid_t(truncatingIfNeeded: number.intValue))
          }
        }
        lock.lock()
        excludePids = next
        lock.unlock()
        continue
      }
      if object["type"] as? String == "activate-pid", let number = object["pid"] as? NSNumber {
        let pid = pid_t(truncatingIfNeeded: number.intValue)
        lock.lock()
        let excluded = excludePids
        lock.unlock()
        if excluded.contains(pid) { continue }
        DispatchQueue.main.async {
          guard let application = NSRunningApplication(processIdentifier: pid), !application.isTerminated else {
            return
          }
          if #available(macOS 14.0, *) {
            _ = application.activate()
          } else {
            _ = application.activate(options: [.activateIgnoringOtherApps])
          }
        }
      }
    }
  }

  private func handle(_ event: NSEvent) {
    let location = NSEvent.mouseLocation
    let point = electronPoint(location)
    switch event.type {
    case .leftMouseDown:
      press = location
      dragged = false
      emit(["type": "mouse-down", "x": point.x, "y": point.y])
    case .leftMouseDragged:
      if let origin = press {
        let dx = location.x - origin.x
        let dy = location.y - origin.y
        if hypot(dx, dy) >= minDragPixels { dragged = true }
      }
    case .leftMouseUp:
      let shouldRead = press != nil && dragged
      press = nil
      dragged = false
      emit(["type": "mouse-up", "x": point.x, "y": point.y])
      if shouldRead {
        DispatchQueue.global(qos: .userInitiated).async {
          self.readSelection(anchor: point)
        }
      }
    case .rightMouseDown, .otherMouseDown:
      emit(["type": "dismiss"])
    case .scrollWheel:
      if !event.momentumPhase.isEmpty { return }
      if event.scrollingDeltaX == 0 && event.scrollingDeltaY == 0 { return }
      emit(["type": "dismiss"])
    case .keyDown:
      if consumePostedCommandC(event) { return }
      emit(["type": "key"])
    default:
      break
    }
  }

  private func notePostedCommandC() {
    lock.lock()
    postedCommandCRemaining += 1
    lock.unlock()
  }

  private func consumePostedCommandC(_ event: NSEvent) -> Bool {
    guard event.keyCode == vkAnsiC, event.modifierFlags.contains(.command) else {
      return false
    }
    lock.lock()
    defer { lock.unlock() }
    guard postedCommandCRemaining > 0 else { return false }
    postedCommandCRemaining -= 1
    return true
  }

  private func readSelection(anchor: (x: Double, y: Double)) {
    usleep(useconds_t(readDelayNs / 1_000))
    lock.lock()
    let excluded = excludePids
    lock.unlock()
    let front = NSWorkspace.shared.frontmostApplication
    if let pid = front?.processIdentifier, excluded.contains(pid) { return }
    if let ax = readAccessibility() {
      emitSelection(
        text: ax.text,
        bounds: ax.bounds,
        pid: front?.processIdentifier,
        bundle: front?.bundleIdentifier,
        x: anchor.x,
        y: anchor.y,
      )
      return
    }
    if let text = readClipboardFallback(onPostCommandC: { self.notePostedCommandC() }) {
      emitSelection(
        text: text,
        bounds: nil,
        pid: front?.processIdentifier,
        bundle: front?.bundleIdentifier,
        x: anchor.x,
        y: anchor.y,
      )
    }
  }

  private func emitSelection(
    text: String,
    bounds: CGRect?,
    pid: pid_t?,
    bundle: String?,
    x: Double? = nil,
    y: Double? = nil,
  ) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return }
    var payload: [String: Any] = ["type": "selection", "text": trimmed]
    if let pid { payload["pid"] = Int(pid) }
    if let bundle { payload["bundle"] = bundle }
    if let bounds { payload["bounds"] = electronRect(bounds) }
    if let x { payload["x"] = x }
    if let y { payload["y"] = y }
    emit(payload)
  }
}

private func readAccessibility() -> (text: String, bounds: CGRect?)? {
  let system = AXUIElementCreateSystemWide()
  var focused: CFTypeRef?
  let focusedError = AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &focused)
  guard focusedError == .success, let element = focused else { return nil }
  var selected: CFTypeRef?
  let selectedError = AXUIElementCopyAttributeValue(
    (element as! AXUIElement),
    kAXSelectedTextAttribute as CFString,
    &selected,
  )
  guard selectedError == .success, let text = selected as? String else { return nil }
  let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
  if trimmed.isEmpty { return nil }
  var rangeValue: CFTypeRef?
  let rangeError = AXUIElementCopyAttributeValue(
    (element as! AXUIElement),
    kAXSelectedTextRangeAttribute as CFString,
    &rangeValue,
  )
  var bounds: CGRect?
  if rangeError == .success, let range = rangeValue {
    var cfRange = CFRange()
    if AXValueGetValue(range as! AXValue, .cfRange, &cfRange), cfRange.length <= 0 { return nil }
    var boundsValue: CFTypeRef?
    let boundsError = AXUIElementCopyParameterizedAttributeValue(
      (element as! AXUIElement),
      kAXBoundsForRangeParameterizedAttribute as CFString,
      range,
      &boundsValue,
    )
    if boundsError == .success, let raw = boundsValue {
      var rect = CGRect.zero
      if AXValueGetValue(raw as! AXValue, .cgRect, &rect) { bounds = rect }
    }
  }
  return (trimmed, bounds)
}

private func readClipboardFallback(onPostCommandC: () -> Void) -> String? {
  let pasteboard = NSPasteboard.general
  let previous = pasteboard.string(forType: .string) ?? ""
  let before = previous.trimmingCharacters(in: .whitespacesAndNewlines)
  guard postCommandC(onPost: onPostCommandC) else { return nil }
  let deadline = DispatchTime.now().uptimeNanoseconds + clipboardDeadlineNs
  while DispatchTime.now().uptimeNanoseconds < deadline {
    let current = (pasteboard.string(forType: .string) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if !current.isEmpty && current != before {
      pasteboard.clearContents()
      if !previous.isEmpty { pasteboard.setString(previous, forType: .string) }
      return current
    }
    usleep(useconds_t(clipboardWaitNs / 1_000))
  }
  pasteboard.clearContents()
  if !previous.isEmpty { pasteboard.setString(previous, forType: .string) }
  return nil
}

private func postCommandC(onPost: () -> Void) -> Bool {
  guard let source = CGEventSource(stateID: .hidSystemState) else { return false }
  guard let down = CGEvent(keyboardEventSource: source, virtualKey: vkAnsiC, keyDown: true),
    let up = CGEvent(keyboardEventSource: source, virtualKey: vkAnsiC, keyDown: false)
  else { return false }
  down.flags = .maskCommand
  up.flags = .maskCommand
  onPost()
  down.post(tap: .cghidEventTap)
  up.post(tap: .cghidEventTap)
  return true
}

private func electronPoint(_ cocoa: NSPoint) -> (x: Double, y: Double) {
  let primary = NSScreen.screens.first { $0.frame.origin == .zero } ?? NSScreen.main
  let maxY = primary?.frame.maxY ?? cocoa.y
  return (Double(cocoa.x), Double(maxY - cocoa.y))
}

private func electronRect(_ cocoa: CGRect) -> [String: Double] {
  let topLeft = electronPoint(NSPoint(x: cocoa.origin.x, y: cocoa.maxY))
  return [
    "x": topLeft.x,
    "y": topLeft.y,
    "width": Double(cocoa.size.width),
    "height": Double(cocoa.size.height),
  ]
}

private func emit(_ payload: [String: Any]) {
  guard JSONSerialization.isValidJSONObject(payload),
    let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
    let line = String(data: data, encoding: .utf8)
  else { return }
  fputs(line + "\n", stdout)
  fflush(stdout)
}
