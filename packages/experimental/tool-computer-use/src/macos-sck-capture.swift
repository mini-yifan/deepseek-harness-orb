import AppKit
import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

@main
enum MacosSckCapture {
  static func main() async {
    do {
      let args = try Arguments.parse(CommandLine.arguments)
      try await capture(args)
    } catch {
      fputs("computer-use: overlay-exclude capture failed: \(error.localizedDescription)\n", stderr)
      exit(1)
    }
  }
}

private struct Arguments {
  var windowId: UInt32
  var excludeWindowIds: [UInt32]
  var output: URL

  static func parse(_ argv: [String]) throws -> Arguments {
    var windowId: UInt32?
    var exclude: [UInt32] = []
    var output: URL?
    for argument in argv.dropFirst() {
      if argument.hasPrefix("--window=") {
        windowId = try parseWindowId(String(argument.dropFirst("--window=".count)))
      } else if argument.hasPrefix("--exclude=") {
        exclude = try parseExclude(String(argument.dropFirst("--exclude=".count)))
      } else if argument.hasPrefix("--out=") {
        output = URL(fileURLWithPath: String(argument.dropFirst("--out=".count)))
      } else {
        throw CaptureError.usage
      }
    }
    guard let windowId, let output else { throw CaptureError.usage }
    if exclude.isEmpty { throw CaptureError.usage }
    return Arguments(windowId: windowId, excludeWindowIds: exclude, output: output)
  }
}

private enum CaptureError: LocalizedError {
  case usage
  case missingWindow(UInt32)
  case noImage
  case jpeg

  var errorDescription: String? {
    switch self {
    case .usage:
      return "usage: macos-sck-capture --window=id --exclude=id[,id...] --out=path"
    case .missingWindow(let id):
      return "overlay window \(id) is not in ScreenCaptureKit shareable content"
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
@MainActor
private func capture(_ args: Arguments) async throws {
  let application = NSApplication.shared
  application.setActivationPolicy(.prohibited)
  let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
  guard let window = content.windows.first(where: { $0.windowID == args.windowId }) else {
    throw CaptureError.missingWindow(args.windowId)
  }
  for id in args.excludeWindowIds {
    guard content.windows.contains(where: { $0.windowID == id }) else {
      throw CaptureError.missingWindow(id)
    }
  }
  let filter = SCContentFilter(desktopIndependentWindow: window)
  let scale = backingScale(for: window.frame, displays: content.displays)
  let configuration = SCStreamConfiguration()
  configuration.showsCursor = true
  configuration.width = max(1, Int((window.frame.width * scale).rounded()))
  configuration.height = max(1, Int((window.frame.height * scale).rounded()))
  let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
  try writeJPEG(image, to: args.output)
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
