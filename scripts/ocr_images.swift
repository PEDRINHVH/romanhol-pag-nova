import Foundation
import Vision
import AppKit

for path in CommandLine.arguments.dropFirst() {
    do {
        let req = VNRecognizeTextRequest()
        req.recognitionLevel = .accurate
        req.usesLanguageCorrection = false
        try VNImageRequestHandler(url: URL(fileURLWithPath: path)).perform([req])
        let rows = (req.results ?? []).compactMap { observation -> [String: Any]? in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let b = observation.boundingBox
            return ["text": candidate.string, "confidence": candidate.confidence,
                    "box": [b.minX, 1-b.maxY, b.width, b.height],
                    "quad": [[observation.topLeft.x,1-observation.topLeft.y],
                             [observation.topRight.x,1-observation.topRight.y],
                             [observation.bottomRight.x,1-observation.bottomRight.y],
                             [observation.bottomLeft.x,1-observation.bottomLeft.y]]]
        }
        let obj: [String: Any] = ["path": path, "texts": rows]
        let data = try JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
        print(String(data: data, encoding: .utf8)!)
    } catch {
        print("{\"error\":\"OCR failed\",\"path\":\"\(path)\"}")
    }
}
