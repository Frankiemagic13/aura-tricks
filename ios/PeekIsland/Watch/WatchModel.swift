import Foundation
import SwiftUI
import WatchKit

/// What the big text on the watch shows.
enum PeekShow: String, CaseIterable, Identifiable {
    case full, lastInput, short
    var id: String { rawValue }
    var label: String {
        switch self {
        case .full: return "Full peek"
        case .lastInput: return "Last input"
        case .short: return "Short"
        }
    }
}

/// How the watch buzzes on a new peek.
enum Buzz: String, CaseIterable, Identifiable {
    case off, once, count
    var id: String { rawValue }
    var label: String {
        switch self {
        case .off: return "Off"
        case .once: return "One buzz"
        case .count: return "Tap last digit"
        }
    }
}

/// Listens to the same Firebase channel as Peek Island on the iPhone.
/// The watch connects by itself (through the iPhone, Wi-Fi or cellular), so the iPhone app does not have to run.
@MainActor
final class WatchModel: NSObject, ObservableObject {
    @Published var peek = ""
    @Published var history: [String] = []
    @Published var blank = false
    @Published var status = "Off"
    @Published var running = false
    @Published var sessionNote = ""

    @Published var topic: String { didSet { save(topic, "topic") } }
    @Published var show: PeekShow { didSet { save(show.rawValue, "show") } }
    @Published var buzz: Buzz { didSet { save(buzz.rawValue, "buzz") } }
    @Published var keepRunning: Bool { didSet { save(keepRunning, "keepRunning"); keepRunning ? startRuntime() : stopRuntime() } }
    @Published var autoStart: Bool { didSet { save(autoStart, "autoStart") } }
    @Published var hideWhenDim: Bool { didSet { save(hideWhenDim, "hideWhenDim") } }
    @Published var textSize: Double { didSet { save(textSize, "textSize") } }

    private static let firebase = "https://peek-island-default-rtdb.firebaseio.com/peeks/"
    private var task: Task<Void, Never>?
    private var buzzTask: Task<Void, Never>?
    private var runtime: WKExtendedRuntimeSession?
    private var lastID = ""
    private var gotFirst = false
    private var streamLive = false

    override init() {
        let d = UserDefaults.standard
        topic = d.string(forKey: "topic") ?? "fvt-c-k27x9m4q8w"
        show = PeekShow(rawValue: d.string(forKey: "show") ?? "") ?? .full
        buzz = Buzz(rawValue: d.string(forKey: "buzz") ?? "") ?? .once
        keepRunning = d.object(forKey: "keepRunning") as? Bool ?? true
        autoStart = d.object(forKey: "autoStart") as? Bool ?? true
        hideWhenDim = d.object(forKey: "hideWhenDim") as? Bool ?? false
        textSize = d.object(forKey: "textSize") as? Double ?? 34
        super.init()
    }

    private func save(_ value: Any, _ key: String) {
        UserDefaults.standard.set(value, forKey: key)
    }

    /// The text for the big display.
    var shown: String {
        switch show {
        case .full: return peek
        case .lastInput: return PeekText.lastInput(from: peek)
        case .short: return PeekText.short(from: peek)
        }
    }

    // MARK: Start and stop

    func start() {
        guard task == nil else { return }
        running = true
        task = Task { await self.listen() }
        if keepRunning { startRuntime() }
    }

    func stop() {
        task?.cancel()
        task = nil
        running = false
        streamLive = false
        status = "Off"
        stopRuntime()
    }

    /// Use after the channel changes.
    func restart() {
        stop()
        gotFirst = false
        lastID = ""
        start()
    }

    /// The app is on screen again: make a new connection (the old one can be stale after the watch slept).
    func wake() {
        guard running else {
            if autoStart { start() }
            return
        }
        task?.cancel()
        streamLive = false
        task = Task { await self.listen() }
        if keepRunning { startRuntime() }
    }

    func clearHistory() {
        history.removeAll()
        peek = ""
    }

    func testBuzz() {
        play(for: peek.isEmpty ? "12 + 34 + 7" : peek)
    }

    // MARK: Firebase

    private struct FBPeek: Decodable {
        let m: String?
        let t: Double?
        let id: String?
    }

    private struct FBEvent: Decodable {
        let path: String
        let data: FBPeek?
    }

    private var url: URL? {
        let safe = topic.trimmingCharacters(in: .whitespacesAndNewlines)
            .addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? topic
        return URL(string: Self.firebase + safe + ".json")
    }

    private func makeSession() -> URLSession {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 90           // Firebase sends a keep-alive every 30 s
        config.timeoutIntervalForResource = 60 * 60 * 24
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }

    private func listen() async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.streamLoop() }
            group.addTask { await self.pollLoop() }
        }
    }

    /// Main way: Firebase streaming (server-sent events). New peeks come in at once.
    private func streamLoop() async {
        let session = makeSession()
        while !Task.isCancelled {
            guard let url else { status = "Bad channel name"; return }
            var req = URLRequest(url: url)
            req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
            do {
                if status != "Listening" { status = "Connecting…" }
                let (bytes, _) = try await session.bytes(for: req)
                var event = ""
                for try await line in bytes.lines {
                    if Task.isCancelled { break }
                    if line.hasPrefix("event:") {
                        event = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
                        streamLive = true
                        status = "Listening"
                    } else if line.hasPrefix("data:"), event == "put" {
                        let json = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                        guard let d = json.data(using: .utf8),
                              let e = try? JSONDecoder().decode(FBEvent.self, from: d),
                              e.path == "/" else { continue }
                        handle(e.data)
                    }
                }
            } catch {
                if Task.isCancelled { break }
            }
            streamLive = false
            if !Task.isCancelled { status = "Reconnecting…" }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }
    }

    /// Backup way: when the stream is down, ask Firebase for the last peek every 1.5 s.
    private func pollLoop() async {
        let session = makeSession()
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            if Task.isCancelled { break }
            if streamLive { continue }
            guard let url, let result = try? await session.data(from: url) else { continue }
            let d = result.0
            if streamLive || Task.isCancelled { continue }
            if let p = try? JSONDecoder().decode(FBPeek?.self, from: d) {
                handle(p)
            } else {
                handle(nil)
            }
            if !streamLive { status = "Listening (backup)" }
        }
    }

    private func handle(_ p: FBPeek?) {
        guard let p, let id = p.id, let text = p.m else { gotFirst = true; return }
        if !gotFirst {                     // value stored before we connected: do not show it
            gotFirst = true
            lastID = id
            return
        }
        guard id != lastID else { return }
        lastID = id
        if let t = p.t, Date().timeIntervalSince1970 * 1000 - t > 120_000 { return }   // older than 2 minutes
        deliver(text)
    }

    private func deliver(_ text: String) {
        if text == "_clear_" { peek = ""; return }
        peek = text
        blank = false
        history.insert(text, at: 0)
        if history.count > 30 { history.removeLast(history.count - 30) }
        play(for: text)
    }

    // MARK: Haptics

    private func play(for text: String) {
        buzzTask?.cancel()
        let device = WKInterfaceDevice.current()
        switch buzz {
        case .off:
            break
        case .once:
            device.play(.notification)
        case .count:
            // Taps the last digit of the last input: 7 = seven taps, 0 = one long buzz.
            let last = PeekText.lastInput(from: text)
            guard let ch = last.last(where: { $0.isNumber }), let n = Int(String(ch)) else {
                device.play(.notification)
                return
            }
            if n == 0 { device.play(.failure); return }
            buzzTask = Task {
                for _ in 0..<n {
                    if Task.isCancelled { return }
                    device.play(.directionUp)
                    try? await Task.sleep(nanoseconds: 450_000_000)
                }
            }
        }
    }

    // MARK: Keep running when the wrist is down

    func startRuntime() {
        guard keepRunning, running else { return }
        if let r = runtime, r.state == .running || r.state == .scheduled || r.state == .notStarted { return }
        let s = WKExtendedRuntimeSession()
        s.delegate = self
        s.start()
        runtime = s
    }

    private func stopRuntime() {
        runtime?.invalidate()
        runtime = nil
        sessionNote = ""
    }
}

extension WatchModel: WKExtendedRuntimeSessionDelegate {
    nonisolated func extendedRuntimeSessionDidStart(_ extendedRuntimeSession: WKExtendedRuntimeSession) {
        Task { @MainActor in self.sessionNote = "Runs with wrist down (up to 1 hour)" }
    }

    nonisolated func extendedRuntimeSessionWillExpire(_ extendedRuntimeSession: WKExtendedRuntimeSession) {
        Task { @MainActor in self.sessionNote = "Background time ends soon. Open the app again." }
    }

    nonisolated func extendedRuntimeSession(_ extendedRuntimeSession: WKExtendedRuntimeSession,
                                            didInvalidateWith reason: WKExtendedRuntimeSessionInvalidationReason,
                                            error: Error?) {
        Task { @MainActor in
            self.runtime = nil
            switch reason {
            case .expired: self.sessionNote = "Background time ended. Open the app to start again."
            case .none: self.sessionNote = ""
            default: self.sessionNote = error?.localizedDescription ?? "Background stopped"
            }
        }
    }
}
