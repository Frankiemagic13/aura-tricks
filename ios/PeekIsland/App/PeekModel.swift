import ActivityKit
import AVFoundation
import Foundation

/// Listens to the calculator channel (ntfy.sh) and shows each peek in the Live Activity.
@MainActor
final class PeekModel: ObservableObject {
    @Published var topic: String { didSet { UserDefaults.standard.set(topic, forKey: "topic") } }
    @Published var title: String { didSet { UserDefaults.standard.set(title, forKey: "title") } }
    @Published var keepAlive: Bool { didSet { UserDefaults.standard.set(keepAlive, forKey: "keepAlive") } }
    @Published var popOpen: Bool { didSet { UserDefaults.standard.set(popOpen, forKey: "popOpen") } }
    @Published private(set) var running = false
    @Published private(set) var status = "Stopped"
    @Published private(set) var log: [String] = []

    // Inject
    @Published var injectID: String { didSet { UserDefaults.standard.set(injectID, forKey: "inject.id") } }
    /// Request to send to Inject. {id} = Inject ID, {text} = the text (URL-encoded).
    @Published var injectURL: String { didSet { UserDefaults.standard.set(injectURL, forKey: "inject.url") } }
    @Published var injectPOST: Bool { didSet { UserDefaults.standard.set(injectPOST, forKey: "inject.post") } }
    @Published private(set) var injectStatus = ""

    // PeekSmith button actions, key "button.event" (for example "1.click")
    @Published private(set) var buttonActions: [String: PeekAction]

    /// Peeks received, newest last
    @Published private(set) var history: [String] = []
    private var backIndex = 0

    let peekSmith = PeekSmithLink()
    private var activity: Activity<PeekAttributes>?
    private var listenTask: Task<Void, Never>?
    private let silence = SilentAudio()

    init() {
        let d = UserDefaults.standard
        topic = d.string(forKey: "topic") ?? "fvt-c-k27x9m4q8w"
        title = d.string(forKey: "title") ?? "Peek"
        keepAlive = d.object(forKey: "keepAlive") as? Bool ?? true
        popOpen = d.object(forKey: "popOpen") as? Bool ?? false
        injectID = d.string(forKey: "inject.id") ?? "13297"
        injectURL = d.string(forKey: "inject.url") ?? ""
        injectPOST = d.object(forKey: "inject.post") as? Bool ?? false
        var map = ButtonMap.defaults
        if let data = d.data(forKey: "buttons"),
           let saved = try? JSONDecoder().decode([String: PeekAction].self, from: data) {
            map.merge(saved) { _, new in new }
        }
        buttonActions = map
        peekSmith.onButton = { [weak self] button, event in
            Task { @MainActor in self?.handleButton(button, event) }
        }
    }

    // MARK: Buttons

    func action(_ button: Int, _ event: String) -> PeekAction {
        buttonActions[ButtonMap.key(button, event)] ?? .none
    }

    func setAction(_ a: PeekAction, _ button: Int, _ event: String) {
        buttonActions[ButtonMap.key(button, event)] = a
        if let data = try? JSONEncoder().encode(buttonActions) {
            UserDefaults.standard.set(data, forKey: "buttons")
        }
    }

    private func handleButton(_ button: Int, _ event: String) {
        guard event == "click" || event == "longpress" else { return }
        let a = action(button, event)
        guard a != .none else { return }
        addLog("Button \(button) \(event): \(a.title)")
        perform(a)
    }

    /// Runs an action (also used by the test buttons in the app).
    func perform(_ a: PeekAction) {
        let last = history.last ?? ""
        if a != .previousPeek { backIndex = 0 }
        switch a {
        case .none:
            break
        case .lastInput:
            peekSmith.send(last.isEmpty ? "No peek yet" : PeekText.lastInput(from: last))
        case .lastPeek:
            peekSmith.send(last.isEmpty ? "No peek yet" : last)
        case .shortPeek:
            peekSmith.send(last.isEmpty ? "No peek yet" : PeekText.short(from: last))
        case .previousPeek:
            guard !history.isEmpty else { peekSmith.send("No peek yet"); return }
            backIndex = (backIndex + 1) % history.count
            peekSmith.send(history[history.count - 1 - backIndex])
        case .clear:
            peekSmith.clear()
        case .inject:
            guard !last.isEmpty else { peekSmith.send("No peek yet"); return }
            sendToInject(PeekText.lastInput(from: last))
        }
    }

    // MARK: Inject

    func sendToInject(_ text: String) {
        let template = injectURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !template.isEmpty else {
            injectStatus = "Set the Inject URL first"
            peekSmith.send("No Inject URL")
            return
        }
        let enc = text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? text
        let id = injectID.trimmingCharacters(in: .whitespaces)
        let urlString = template.replacingOccurrences(of: "{id}", with: id)
            .replacingOccurrences(of: "{text}", with: injectPOST ? "" : enc)
        guard let url = URL(string: urlString) else {
            injectStatus = "The Inject URL is not valid"
            peekSmith.send("Bad Inject URL")
            return
        }
        var req = URLRequest(url: url, timeoutInterval: 10)
        if injectPOST {
            req.httpMethod = "POST"
            req.httpBody = text.data(using: .utf8)
        }
        injectStatus = "Sending…"
        Task {
            do {
                let (_, resp) = try await URLSession.shared.data(for: req)
                let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
                if (200..<300).contains(code) {
                    injectStatus = "Sent \"\(text)\" ✓"
                    peekSmith.send("Inject: \(text)")
                } else {
                    injectStatus = "Inject answered \(code)"
                    peekSmith.send("Inject error \(code)")
                }
            } catch {
                injectStatus = "Not sent: \(error.localizedDescription)"
                peekSmith.send("Inject failed")
            }
            addLog("Inject: \(injectStatus)")
        }
    }

    var activitiesEnabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    // MARK: Start / stop

    func start() {
        guard !running else { return }
        Task {
            // End old activities from an earlier run
            for a in Activity<PeekAttributes>.activities {
                await a.end(nil, dismissalPolicy: .immediate)
            }
            let state = PeekAttributes.ContentState(full: "Ready", short: "•", updated: .now)
            do {
                activity = try Activity.request(
                    attributes: PeekAttributes(title: title),
                    content: .init(state: state, staleDate: nil),
                    pushType: nil
                )
                addLog("Live Activity started")
            } catch {
                addLog("Live Activity failed: \(error.localizedDescription)")
            }
            if keepAlive { silence.start() }
            running = true
            listenTask = Task { await listenLoop() }
        }
    }

    func stop() {
        listenTask?.cancel()
        listenTask = nil
        silence.stop()
        running = false
        status = "Stopped"
        let a = activity
        activity = nil
        Task {
            await a?.end(nil, dismissalPolicy: .immediate)
            for other in Activity<PeekAttributes>.activities {
                await other.end(nil, dismissalPolicy: .immediate)
            }
        }
        addLog("Stopped")
    }

    func test() {
        Task { await show("12 + 34 + 56 + 8 taps") }
    }

    // MARK: Channel

    private struct NtfyMessage: Decodable {
        let event: String
        let message: String?
    }

    private func listenLoop() async {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 120          // ntfy sends a keepalive every 45 s
        config.timeoutIntervalForResource = 60 * 60 * 24
        let session = URLSession(configuration: config)
        let safeTopic = topic.trimmingCharacters(in: .whitespacesAndNewlines)
            .addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? topic

        while !Task.isCancelled {
            guard let url = URL(string: "https://ntfy.sh/\(safeTopic)/json") else {
                status = "Bad channel name"
                return
            }
            do {
                status = "Connecting…"
                let (bytes, _) = try await session.bytes(from: url)
                status = "Listening"
                for try await line in bytes.lines {
                    if Task.isCancelled { break }
                    guard let data = line.data(using: .utf8),
                          let m = try? JSONDecoder().decode(NtfyMessage.self, from: data) else { continue }
                    if m.event == "message", let text = m.message {
                        await show(text)
                    }
                }
            } catch {
                if Task.isCancelled { break }
                status = "Reconnecting…"
            }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }
    }

    private func show(_ text: String) async {
        addLog(text)
        history.append(text)
        if history.count > 50 { history.removeFirst(history.count - 50) }
        backIndex = 0
        let short = PeekText.short(from: text)
        peekSmith.send(peekSmith.shortOnly ? short : text)
        let state = PeekAttributes.ContentState(full: text, short: short, updated: .now)
        let content = ActivityContent(state: state, staleDate: nil)
        if popOpen {
            // Opens the Dynamic Island for a moment (and lights the lock screen)
            await activity?.update(content, alertConfiguration: AlertConfiguration(
                title: "\(title)", body: "\(text)", sound: .default))
        } else {
            await activity?.update(content)
        }
    }

    private func addLog(_ s: String) {
        let time = Date.now.formatted(date: .omitted, time: .standard)
        log.insert("\(time)  \(s)", at: 0)
        if log.count > 60 { log.removeLast(log.count - 60) }
    }
}

/// Plays silence so that iOS keeps the app running in the background.
/// It mixes with other audio, so your music is not stopped.
final class SilentAudio {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var attached = false
    private var observer: NSObjectProtocol?

    func start() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, options: [.mixWithOthers])
        try? session.setActive(true)

        guard let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44_100) else { return }
        buffer.frameLength = 44_100 // one second of zeros (silence)

        if !attached {
            engine.attach(player)
            engine.connect(player, to: engine.mainMixerNode, format: format)
            attached = true
        }
        do { try engine.start() } catch { return }
        player.scheduleBuffer(buffer, at: nil, options: .loops)
        player.play()

        // Start again after a phone call or other interruption
        observer = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] note in
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
            self?.stop()
            self?.start()
        }
    }

    func stop() {
        if let o = observer { NotificationCenter.default.removeObserver(o) }
        observer = nil
        player.stop()
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
