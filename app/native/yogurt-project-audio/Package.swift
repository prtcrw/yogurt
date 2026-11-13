// swift-tools-version: 6.2
import PackageDescription
let package = Package(
    name: "YogurtProjectAudio", platforms: [.macOS(.v14)],
    products: [.executable(name: "yogurt-project-audio", targets: ["YogurtProjectAudio"])],
    dependencies: [.package(url: "https://github.com/FluidInference/FluidAudio.git", revision: "d653a34a620c013febd7530427b4963ae18064b2", traits: ["Diarizer"])],
    targets: [.executableTarget(name: "YogurtProjectAudio", dependencies: [.product(name: "FluidAudio", package: "FluidAudio")])]
)
