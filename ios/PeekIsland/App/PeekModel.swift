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
    /// Name of the POST field that carries the text (Inject: "value").
    @Published var injectKey: String { didSet { UserDefaults.standard.set(injectKey, forKey: "inject.key") } }
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
        let savedURL = d.string(forKey: "inject.url") ?? ""
        injectURL = savedURL.isEmpty ? Self.injectDefaultURL : savedURL
        injectPOST = savedURL.isEmpty ? true : (d.object(forKey: "inject.post") as? Bool ?? true)
        injectKey = d.string(forKey: "inject.key") ?? "value"
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

    static let injectDefaultURL = "https://11z.co/_w/{id}/selection"

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
        let key = injectKey.trimmingCharacters(in: .whitespaces).isEmpty ? "value" : injectKey.trimmingCharacters(in: .whitespaces)
        injectStatus = "Sending…"
        Task {
            var code = 0
            var failure: String?
            // 1st try: form field (value=…). 2nd try, only if Inject refuses the form: JSON {"value": "…"}.
            for json in (injectPOST ? [false, true] : [false]) {
                var req = URLRequest(url: url, timeoutInterval: 10)
                if injectPOST {
                    req.httpMethod = "POST"
                    if json {
                        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                        req.httpBody = try? JSONSerialization.data(withJSONObject: [key: text])
                    } else {
                        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
                        var allowed = CharacterSet.alphanumerics
                        allowed.insert(charactersIn: "-._~")
                        let k = key.addingPercentEncoding(withAllowedCharacters: allowed) ?? key
                        let v = text.addingPercentEncoding(withAllowedCharacters: allowed) ?? text
                        req.httpBody = "\(k)=\(v)".data(using: .utf8)
                    }
                }
                do {
                    let (_, resp) = try await URLSession.shared.data(for: req)
                    code = (resp as? HTTPURLResponse)?.statusCode ?? 0
                    failure = nil
                    if (200..<300).contains(code) { break }
                } catch {
                    failure = error.localizedDescription
                    break
                }
            }
            if let failure {
                injectStatus = "Not sent: \(failure)"
                peekSmith.send("Inject failed")
            } else if (200..<300).contains(code) {
                injectStatus = "Sent \"\(text)\" ✓"
                peekSmith.send("Inject: \(text)")
            } else {
                injectStatus = "Inject answered \(code)"
                peekSmith.send("Inject error \(code)")
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

    /// Firebase Realtime Database value written by the pages: {m, title, t, id}
    private struct FBPeek: Decodable {
        let m: String?
        let t: Double?
        let id: String?
    }

    private struct FBEvent: Decodable {
        let path: String
        let data: FBPeek?
    }

    private static let firebase = "https://peek-island-default-rtdb.firebaseio.com/peeks/"
    private var recent: [String: Date] = [:]
    private var lastFirebaseID = ""

    /// Both channels can bring the same peek (Firebase is main, ntfy.sh is the backup): show it once.
    private func deliver(_ text: String) async {
        let now = Date()
        recent = recent.filter { now.timeIntervalSince($0.value) < 5 }
        guard recent[text] == nil else { return }
        recent[text] = now
        await show(text)
    }

    private func listenLoop() async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.firebaseLoop() }
            group.addTask { await self.ntfyLoop() }
        }
    }

    private func makeSession() -> URLSession {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 120          // both services send a keepalive within 60 s
        config.timeoutIntervalForResource = 60 * 60 * 24
        return URLSession(configuration: config)
    }

    private var safeTopic: String {
        topic.trimmingCharacters(in: .whitespacesAndNewlines)
            .addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? topic
    }

    /// Main channel: Firebase streaming (server-sent events), no daily message limit.
    private func firebaseLoop() async {
        let session = makeSession()
        while !Task.isCancelled {
            guard let url = URL(string: Self.firebase + safeTopic + ".json") else { status = "Bad channel name"; return }
            var req = URLRequest(url: url)
            req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
            do {
                status = "Connecting…"
                let (bytes, _) = try await session.bytes(for: req)
                status = "Listening"
                var event = "", first = true
                for try await line in bytes.lines {
                    if Task.isCancelled { break }
                    if line.hasPrefix("event:") {
                        event = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
                    } else if line.hasPrefix("data:"), event == "put" {
                        let json = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                        guard let d = json.data(using: .utf8),
                              let e = try? JSONDecoder().decode(FBEvent.self, from: d),
                              e.path == "/", let p = e.data, let id = p.id, let text = p.m else { first = false; continue }
                        let wasFirst = first
                        first = false
                        if id == lastFirebaseID { continue }
                        lastFirebaseID = id
                        if wasFirst { continue }        // value that was already stored before we connected
                        await deliver(text)
                    }
                }
            } catch {
                if Task.isCancelled { break }
                status = "Reconnecting…"
            }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }
    }

    /// Backup channel: ntfy.sh (used by the pages only when Firebase cannot be reached).
    private func ntfyLoop() async {
        let session = makeSession()
        while !Task.isCancelled {
            guard let url = URL(string: "https://ntfy.sh/\(safeTopic)/json") else { return }
            do {
                let (bytes, _) = try await session.bytes(from: url)
                for try await line in bytes.lines {
                    if Task.isCancelled { break }
                    guard let data = line.data(using: .utf8),
                          let m = try? JSONDecoder().decode(NtfyMessage.self, from: data) else { continue }
                    if m.event == "message", let text = m.message {
                        await deliver(text)
                    }
                }
            } catch {
                if Task.isCancelled { break }
            }
            try? await Task.sleep(nanoseconds: 3_000_000_000)
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
