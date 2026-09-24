import AppKit
import CoreGraphics
import Dispatch
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

#if DSH_SCK_CLI
@main
enum MacosSckCapture {
  static func main() async {
    do {
      let args = try Arguments.parse(CommandLine.arguments)
      try await capture(args, startCliApplication: true)
    } catch {
      fputs("computer-use: overlay-exclude capture failed: \(error.localizedDescription)\n", stderr)
      exit(1)
    }
  }
}
#endif

private enum CaptureTarget {
  case window(UInt32)
  case region(CGRect)
}

private struct Arguments {
  var target: CaptureTarget
  var excludeWindowIds: [UInt32]
  var output: URL

  static func parse(_ argv: [String]) throws -> Arguments {
    var windowId: UInt32?
    var region: CGRect?
    var exclude: [UInt32] = []
    var output: URL?
    for argument in argv.dropFirst() {
      if argument.hasPrefix("--window=") {
        windowId = try parseWindowId(String(argument.dropFirst("--window=".count)))
      } else if argument.hasPrefix("--region=") {
        region = try parseRegion(String(argument.dropFirst("--region=".count)))
      } else if argument.hasPrefix("--exclude=") {
        exclude = try parseExclude(String(argument.dropFirst("--exclude=".count)))
      } else if argument.hasPrefix("--out=") {
        output = URL(fileURLWithPath: String(argument.dropFirst("--out=".count)))
      } else {
        throw CaptureError.usage
      }
    }
    guard let output else { throw CaptureError.usage }
    if exclude.isEmpty { throw CaptureError.usage }
    switch (windowId, region) {
    case (let windowId?, nil):
      return Arguments(target: .window(windowId), excludeWindowIds: exclude, output: output)
    case (nil, let region?):
      return Arguments(target: .region(region), excludeWindowIds: exclude, output: output)
    default:
      throw CaptureError.usage
    }
  }
}

private enum CaptureError: LocalizedError {
  case usage
  case missingWindow(UInt32)
  case noDisplay
  case noImage
  case jpeg

  var errorDescription: String? {
    switch self {
    case .usage:
      return "usage: macos-sck-capture (--window=id | --region=x,y,w,h) --exclude=id[,id...] --out=path"
    case .missingWindow(let id):
      return "overlay window \(id) is not in ScreenCaptureKit shareable content"
    case .noDisplay:
      return "capture region does not intersect a display"
    case .noImage:
      return "ScreenCaptureKit returned no image"
    case .jpeg:
      return "failed to write JPEG"
    }
  }
}

private func parseWindowId(_ value: String) throws -> UInt32 {
  guard let parsed = UInt32(value), parsed >= 1 else { throw CaptureError.usage }
  return parsed
}

private func parseRegion(_ value: String) throws -> CGRect {
  let parts = value.split(separator: ",")
  guard parts.count == 4,
    let x = Double(parts[0]),
    let y = Double(parts[1]),
    let width = Double(parts[2]),
    let height = Double(parts[3]),
    width >= 1,
    height >= 1
  else { throw CaptureError.usage }
  return CGRect(x: x, y: y, width: width, height: height)
}

private func parseExclude(_ value: String) throws -> [UInt32] {
  let parts = value.split(separator: ",")
  var ids: [UInt32] = []
  for part in parts {
    guard let parsed = UInt32(part), parsed >= 1 else { throw CaptureError.usage }
    ids.append(parsed)
  }
  if ids.isEmpty { throw CaptureError.usage }
  return ids
}

/// Window capture uses CGS; a CLI `@main` task is not a GUI process until AppKit starts on the main actor.
/// Desktop loads this as a dylib inside Electron and must not change the host activation policy.
@MainActor
private func capture(_ args: Arguments, startCliApplication: Bool) async throws {
  if startCliApplication {
    let application = NSApplication.shared
    application.setActivationPolicy(.prohibited)
  }
  let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
  for id in args.excludeWindowIds {
    guard content.windows.contains(where: { $0.windowID == id }) else {
      throw CaptureError.missingWindow(id)
    }
  }
  let excludeWindows = args.excludeWindowIds.compactMap { id in
    content.windows.first { $0.windowID == id }
  }
  switch args.target {
  case .window(let windowId):
    guard let window = content.windows.first(where: { $0.windowID == windowId }) else {
      throw CaptureError.missingWindow(windowId)
    }
    let filter = SCContentFilter(desktopIndependentWindow: window)
    let scale = backingScale(for: window.frame, displays: content.displays)
    let configuration = SCStreamConfiguration()
    configuration.showsCursor = true
    configuration.width = max(1, Int((window.frame.width * scale).rounded()))
    configuration.height = max(1, Int((window.frame.height * scale).rounded()))
    let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
    try writeJPEG(image, to: args.output)
  case .region(let region):
    guard let display = displayOverlapping(region, displays: content.displays) else {
      throw CaptureError.noDisplay
    }
    let clipped = region.intersection(display.frame)
    guard !clipped.isNull && clipped.width >= 1 && clipped.height >= 1 else {
      throw CaptureError.noDisplay
    }
    let filter = SCContentFilter(display: display, excludingWindows: excludeWindows)
    let scale = CGFloat(display.width) / max(display.frame.width, 1)
    let configuration = SCStreamConfiguration()
    configuration.showsCursor = true
    configuration.sourceRect = clipped.offsetBy(dx: -display.frame.minX, dy: -display.frame.minY)
    configuration.width = max(1, Int((clipped.width * scale).rounded()))
    configuration.height = max(1, Int((clipped.height * scale).rounded()))
    let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
    try writeJPEG(image, to: args.output)
  }
}

private func displayOverlapping(_ region: CGRect, displays: [SCDisplay]) -> SCDisplay? {
  var best: SCDisplay?
  var bestArea: CGFloat = 0
  for display in displays {
    let overlap = display.frame.intersection(region)
    if overlap.isNull || overlap.isInfinite { continue }
    let area = overlap.width * overlap.height
    if area > bestArea {
      bestArea = area
      best = display
    }
  }
  return bestArea > 0 ? best : nil
}

private func backingScale(for frame: CGRect, displays: [SCDisplay]) -> CGFloat {
  let display = displays.first { candidate in
    candidate.frame.insetBy(dx: -1, dy: -1).contains(CGPoint(x: frame.midX, y: frame.midY))
  } ?? displays.first
  guard let display else { return 2 }
  return CGFloat(display.width) / max(display.frame.width, 1)
}

private func writeJPEG(_ image: CGImage, to url: URL) throws {
  guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
    throw CaptureError.jpeg
  }
  CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
  if !CGImageDestinationFinalize(destination) { throw CaptureError.jpeg }
}

private func writeCString(_ message: String, to buffer: UnsafeMutablePointer<CChar>?, length: Int32) {
  guard let buffer, length > 1 else { return }
  let bytes = Array(message.utf8)
  let count = min(bytes.count, Int(length) - 1)
  for index in 0..<count {
    buffer[index] = CChar(bitPattern: bytes[index])
  }
  buffer[count] = 0
}

/// Overlay-exclude capture for the Desktop Electron process. Callers must not invoke this on the main thread.
/// @param region Region `x,y,w,h` string, or null when unused with a window id.
/// @param exclude Comma-separated CGWindowIDs.
/// @param output JPEG destination path.
/// @param errorBuffer Optional UTF-8 error message buffer.
/// @param errorLength Capacity of `errorBuffer`.
/// @returns 0 on success, 1 on failure.
@_cdecl("dsh_macos_sck_capture")
public func dsh_macos_sck_capture(
  region: UnsafePointer<CChar>?,
  exclude: UnsafePointer<CChar>?,
  output: UnsafePointer<CChar>?,
  errorBuffer: UnsafeMutablePointer<CChar>?,
  errorLength: Int32,
) -> Int32 {
  var argv = ["macos-sck-capture"]
  if let region {
    argv.append("--region=\(String(cString: region))")
  }
  if let exclude {
    argv.append("--exclude=\(String(cString: exclude))")
  }
  if let output {
    argv.append("--out=\(String(cString: output))")
  }
  let args: Arguments
  do {
    args = try Arguments.parse(argv)
  } catch {
    writeCString(error.localizedDescription, to: errorBuffer, length: errorLength)
    return 1
  }
  let lock = DispatchSemaphore(value: 0)
  var failure: String?
  DispatchQueue.main.async {
    Task { @MainActor in
      do {
        try await capture(args, startCliApplication: false)
      } catch {
        failure = error.localizedDescription
      }
      lock.signal()
    }
  }
  lock.wait()
  if let failure {
    writeCString(failure, to: errorBuffer, length: errorLength)
    return 1
  }
  return 0
}
