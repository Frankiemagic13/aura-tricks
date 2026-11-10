import SwiftUI

@main
struct PeekIslandApp: App {
    @StateObject private var model = PeekModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .environmentObject(model.peekSmith)
        }
    }
}
