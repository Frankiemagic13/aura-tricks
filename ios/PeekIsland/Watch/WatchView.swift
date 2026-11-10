import SwiftUI

private let accent = Color(red: 0.95, green: 0.64, blue: 0.24)

@main
struct PeekWatchApp: App {
    @StateObject private var model = WatchModel()

    var body: some Scene {
        WindowGroup {
            WatchView()
                .environmentObject(model)
        }
    }
}

/// Three pages. Turn the Digital Crown or swipe up: peek → history → settings.
struct WatchView: View {
    @EnvironmentObject private var m: WatchModel
    @Environment(\.scenePhase) private var phase

    var body: some View {
        TabView {
            PeekPage()
            HistoryPage()
            SettingsPage()
        }
        .tabViewStyle(.verticalPage)
        .onAppear { if m.autoStart { m.start() } }
        .onChange(of: phase) { _, p in
            if p == .active { m.wake() }
        }
    }
}

/// The peek, in large text. Tap the screen to blank it, tap again to show it.
struct PeekPage: View {
    @EnvironmentObject private var m: WatchModel
    @Environment(\.isLuminanceReduced) private var dim

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if !m.running {
                VStack(spacing: 10) {
                    Text("Peek Island").font(.headline)
                    Button("Start") { m.start() }
                        .tint(accent)
                }
            } else if m.blank || m.peek.isEmpty || (dim && m.hideWhenDim) {
                // Looks like an empty screen. A very small dot shows the connection.
                VStack {
                    HStack {
                        Circle()
                            .fill(m.status.hasPrefix("Listening") ? Color.green.opacity(0.35) : Color.orange.opacity(0.5))
                            .frame(width: 4, height: 4)
                        Spacer()
                    }
                    Spacer()
                }
                .padding(.leading, 6)
            } else {
                VStack(spacing: 4) {
                    Text(m.shown)
                        .font(.system(size: m.textSize, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(accent)
                        .multilineTextAlignment(.center)
                        .lineLimit(4)
                        .minimumScaleFactor(0.3)
                    if m.show != .full {
                        Text(m.peek)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .lineLimit(3)
                            .minimumScaleFactor(0.6)
                    }
                }
                .padding(.horizontal, 4)
                .opacity(dim ? 0.7 : 1)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { if m.running { m.blank.toggle() } }
    }
}

/// The last 30 peeks. Tap one to show it again.
struct HistoryPage: View {
    @EnvironmentObject private var m: WatchModel

    var body: some View {
        NavigationStack {
            List {
                if m.history.isEmpty {
                    Text("No peeks yet").foregroundStyle(.secondary)
                }
                ForEach(Array(m.history.enumerated()), id: \.offset) { _, item in
                    Button {
                        m.peek = item
                        m.blank = false
                    } label: {
                        Text(item).lineLimit(3)
                    }
                }
                if !m.history.isEmpty {
                    Button("Clear", role: .destructive) { m.clearHistory() }
                }
            }
            .navigationTitle("History")
        }
    }
}

struct SettingsPage: View {
    @EnvironmentObject private var m: WatchModel

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button(m.running ? "Stop" : "Start") { m.running ? m.stop() : m.start() }
                        .foregroundStyle(m.running ? .red : accent)
                    Text(m.status).font(.footnote).foregroundStyle(.secondary)
                }
                Section("Display") {
                    Picker("Show", selection: $m.show) {
                        ForEach(PeekShow.allCases) { Text($0.label).tag($0) }
                    }
                    Stepper(value: $m.textSize, in: 16...64, step: 4) {
                        Text("Size \(Int(m.textSize))")
                    }
                    Toggle("Hide when wrist down", isOn: $m.hideWhenDim)
                }
                Section("Buzz") {
                    Picker("On new peek", selection: $m.buzz) {
                        ForEach(Buzz.allCases) { Text($0.label).tag($0) }
                    }
                    Button("Test buzz") { m.testBuzz() }
                }
                Section {
                    Toggle("Keep running", isOn: $m.keepRunning)
                    Toggle("Start on open", isOn: $m.autoStart)
                    if !m.sessionNote.isEmpty {
                        Text(m.sessionNote).font(.footnote).foregroundStyle(.secondary)
                    }
                } footer: {
                    Text("Keep running lets the watch get peeks for up to 1 hour when your wrist is down.")
                }
                Section("Channel") {
                    TextField("Channel", text: $m.topic)
                        .onSubmit { m.restart() }
                }
            }
            .navigationTitle("Settings")
        }
    }
}
