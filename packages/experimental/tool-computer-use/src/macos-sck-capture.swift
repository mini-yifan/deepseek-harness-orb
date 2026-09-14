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
  var rect: CGRect
  var excludeWindowIds: [UInt32]
  var output: URL

  static func parse(_ argv: [String]) throws -> Arguments {
    var rect: CGRect?
    var exclude: [UInt32] = []
    var output: URL?
    for argument in argv.dropFirst() {
      if argument.hasPrefix("--rect=") {
        rect = try parseRect(String(argument.dropFirst("--rect=".count)))
      } else if argument.hasPrefix("--exclude=") {
        exclude = try parseExclude(String(argument.dropFirst("--exclude=".count)))
      } else if argument.hasPrefix("--out=") {
        output = URL(fileURLWithPath: String(argument.dropFirst("--out=".count)))
      } else {
        throw CaptureError.usage
      }
    }
    guard let rect, let output else { throw CaptureError.usage }
    if exclude.isEmpty { throw CaptureError.usage }
    return Arguments(rect: rect, excludeWindowIds: exclude, output: output)
  }
}

private enum CaptureError: LocalizedError {
  case usage
  case noDisplay
  case missingWindow(UInt32)
  case noImage
  case jpeg

  var errorDescription: String? {
    switch self {
    case .usage:
      return "usage: macos-sck-capture --rect=x,y,w,h --exclude=id[,id...] --out=path"
    case .noDisplay:
      return "no ScreenCaptureKit display matches the capture rectangle"
    case .missingWindow(let id):
      return "overlay window \(id) is not in ScreenCaptureKit shareable content"
    case .noImage:
      return "ScreenCaptureKit returned no image"
    case .jpeg:
      return "failed to write JPEG"
    }
  }
}

private func parseRect(_ value: String) throws -> CGRect {
  let parts = value.split(separator: ",").compactMap { Double($0) }
  guard parts.count == 4 else { throw CaptureError.usage }
  let width = parts[2]
  let height = parts[3]
  guard width > 0, height > 0 else { throw CaptureError.usage }
  return CGRect(x: parts[0], y: parts[1], width: width, height: height)
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

private func capture(_ args: Arguments) async throws {
  let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
  guard let display = matchDisplay(content.displays, rect: args.rect) else {
    throw CaptureError.noDisplay
  }
  var excluded: [SCWindow] = []
  for id in args.excludeWindowIds {
    guard let window = content.windows.first(where: { $0.windowID == id }) else {
      throw CaptureError.missingWindow(id)
    }
    excluded.append(window)
  }
  let filter = SCContentFilter(display: display, excludingWindows: excluded)
  let local = args.rect.offsetBy(dx: -display.frame.origin.x, dy: -display.frame.origin.y)
  let clipped = local.intersection(CGRect(origin: .zero, size: display.frame.size))
  guard !clipped.isNull, clipped.width > 0, clipped.height > 0 else {
    throw CaptureError.noDisplay
  }
  let scale = CGFloat(display.width) / max(display.frame.width, 1)
  let configuration = SCStreamConfiguration()
  configuration.showsCursor = true
  configuration.sourceRect = clipped
  configuration.width = max(1, Int((clipped.width * scale).rounded()))
  configuration.height = max(1, Int((clipped.height * scale).rounded()))
  let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
  try writeJPEG(image, to: args.output)
}

private func matchDisplay(_ displays: [SCDisplay], rect: CGRect) -> SCDisplay? {
  let sized = displays.filter { display in
    abs(display.frame.width - rect.width) < 1 && abs(display.frame.height - rect.height) < 1
  }
  if sized.count == 1 { return sized[0] }
  return displays.first { display in
    framesMatch(display.frame, rect)
  } ?? displays.first { display in
    display.frame.insetBy(dx: -1, dy: -1).contains(CGPoint(x: rect.midX, y: rect.midY))
  }
}

private func framesMatch(_ left: CGRect, _ right: CGRect) -> Bool {
  abs(left.origin.x - right.origin.x) < 1
    && abs(left.origin.y - right.origin.y) < 1
    && abs(left.width - right.width) < 1
    && abs(left.height - right.height) < 1
}

private func writeJPEG(_ image: CGImage, to url: URL) throws {
  guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
    throw CaptureError.jpeg
  }
  CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
  if !CGImageDestinationFinalize(destination) { throw CaptureError.jpeg }
}
