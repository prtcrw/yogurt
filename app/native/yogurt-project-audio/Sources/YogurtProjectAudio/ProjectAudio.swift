import Foundation
import AVFoundation
import AudioToolbox
import FluidAudio

func json(_ value: Any, to path: String) throws {
    try JSONSerialization.data(withJSONObject: value).write(to: URL(fileURLWithPath: path), options: .atomic)
}
func decode(_ input: String, _ output: String) async throws {
    let asset = AVURLAsset(url: URL(fileURLWithPath: input))
    guard let track = try await asset.loadTracks(withMediaType: .audio).first else { throw NSError(domain: "Yogurt", code: 1, userInfo: [NSLocalizedDescriptionKey: "This file has no audio track"]) }
    let reader = try AVAssetReader(asset: asset)
    let settings: [String: Any] = [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16000,
        AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false]
    let stream = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
    reader.add(stream)
    FileManager.default.createFile(atPath: output, contents: Data(repeating: 0, count: 44))
    let file = try FileHandle(forWritingTo: URL(fileURLWithPath: output))
    defer { try? file.close() }
    try file.seekToEnd()
    guard reader.startReading() else { throw reader.error ?? NSError(domain: "Yogurt", code: 2) }
    var count: UInt64 = 0
    while let sample = stream.copyNextSampleBuffer() {
        guard let block = CMSampleBufferGetDataBuffer(sample) else { continue }
        let size = CMBlockBufferGetDataLength(block)
        var bytes = Data(count: size)
        let status = bytes.withUnsafeMutableBytes { CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: size, destination: $0.baseAddress!) }
        if status != kCMBlockBufferNoErr { throw NSError(domain: "Yogurt", code: Int(status)) }
        try file.write(contentsOf: bytes); count += UInt64(size)
        if count > UInt64(UInt32.max) - 36 { throw NSError(domain: "Yogurt", code: 3, userInfo: [NSLocalizedDescriptionKey: "Recording is too long; split it before importing"]) }
    }
    guard reader.status == .completed else { throw reader.error ?? NSError(domain: "Yogurt", code: 4) }
    var header = Data()
    func word<T: FixedWidthInteger>(_ value: T) { var v = value.littleEndian; withUnsafeBytes(of: &v) { header.append(contentsOf: $0) } }
    header.append(Data("RIFF".utf8)); word(UInt32(count + 36)); header.append(Data("WAVEfmt ".utf8))
    word(UInt32(16)); word(UInt16(1)); word(UInt16(1)); word(UInt32(16000)); word(UInt32(32000)); word(UInt16(2)); word(UInt16(16))
    header.append(Data("data".utf8)); word(UInt32(count))
    try file.seek(toOffset: 0); try file.write(contentsOf: header); try file.synchronize()
}
@main struct Main {
    static func main() async {
        do {
            let args = CommandLine.arguments
            guard args.count >= 4 else { throw NSError(domain: "Yogurt", code: 5, userInfo: [NSLocalizedDescriptionKey: "Expected decode INPUT OUTPUT or diarize WAV RESULT MODELS"]) }
            if args[1] == "decode" { try await decode(args[2], args[3]); return }
            guard args[1] == "diarize", args.count == 5 else { throw NSError(domain: "Yogurt", code: 6) }
            let samples = try AudioConverter().resampleAudioFile(URL(fileURLWithPath: args[2]))
            let manager = DiarizerManager()
            let models = try await DiarizerModels.download(to: URL(fileURLWithPath: args[4], isDirectory: true))
            manager.initialize(models: models)
            defer { manager.cleanup() }
            let result = try manager.performCompleteDiarization(samples)
            let rows: [[String: Any]] = result.segments.map { s in ["speaker": s.speakerId, "startMs": Double(s.startTimeSeconds) * 1000, "endMs": Double(s.endTimeSeconds) * 1000, "embedding": s.embedding, "quality": s.qualityScore] }
            try json(["model": "fluidaudio-wespeaker256-d653a34", "segments": rows], to: args[3])
        } catch {
            FileHandle.standardError.write(Data(("\(error.localizedDescription)\n").utf8)); exit(1)
        }
    }
}
