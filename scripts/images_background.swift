import Foundation
import Vision
import CoreImage

let context = CIContext()
let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
let jobs = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [[String:String]]
for job in jobs {
    autoreleasepool {
        do {
            let target = URL(fileURLWithPath: job["output"]!)
            if FileManager.default.fileExists(atPath: target.path) { return }
            let handler = VNImageRequestHandler(url: URL(fileURLWithPath: job["path"]!))
            let request = VNGenerateForegroundInstanceMaskRequest()
            try handler.perform([request])
            guard let observation = request.results?.first, !observation.allInstances.isEmpty else {
                throw NSError(domain: "NoForeground", code: 1)
            }
            let buffer = try observation.generateMaskedImage(ofInstances: observation.allInstances, from: handler, croppedToInstancesExtent: false)
            try context.writePNGRepresentation(of: CIImage(cvPixelBuffer: buffer), to: target, format: .RGBA8, colorSpace: colorSpace)
            print("OK \(target.path)")
        } catch { print("ERROR \(job["path"]!) \(error)") }
        fflush(stdout)
    }
}
