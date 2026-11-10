import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: PeekModel
    @EnvironmentObject private var ps: PeekSmithLink

    var body: some View {
        NavigationStack {
            Form {
                if !model.activitiesEnabled {
                    Section {
                        Text("Live Activities are off. Go to Settings → Peek Island and turn on Live Activities.")
                            .foregroundStyle(.red)
                    }
                }

                Section {
                    HStack {
                        Circle()
                            .fill(model.status == "Listening" ? .green : (model.running ? .orange : .gray))
                            .frame(width: 10, height: 10)
                        Text(model.status)
                    }
                    Button(model.running ? "Stop" : "Start") {
                        model.running ? model.stop() : model.start()
                    }
                    .font(.headline)
                    Button("Send test peek") { model.test() }
                        .disabled(!model.running)
                }

                Section {
                    Toggle("Send peeks to PeekSmith", isOn: $ps.enabled)
                    HStack {
                        Circle()
                            .fill(ps.connected ? .green : .gray)
                            .frame(width: 10, height: 10)
                        VStack(alignment: .leading) {
                            Text(ps.connected ? ps.deviceName : "PeekSmith")
                            Text(ps.status).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    if ps.connected {
                        Button("Send test to PeekSmith") { ps.test() }
                        Button("Disconnect", role: .destructive) { ps.disconnect() }
                    } else {
                        Button("Connect PeekSmith") { ps.connect() }
                            .disabled(!ps.enabled)
                    }
                    Toggle("Short peek only", isOn: $ps.shortOnly)
                    Toggle("Vibrate on each peek", isOn: $ps.vibrate)
                    Picker("Text prefix", selection: $ps.prefix) {
                        Text("$").tag("$")
                        Text("#").tag("#")
                    }
                    if !ps.lastReply.isEmpty {
                        Text("PeekSmith says: \(ps.lastReply)").font(.caption).foregroundStyle(.secondary)
                    }
                    Button("Forget this PeekSmith") { ps.forget() }
                        .font(.footnote)
                } header: {
                    Text("PeekSmith")
                } footer: {
                    Text("Turn the PeekSmith on, then tap Connect. It also works when the PeekSmith app is connected. \"Short peek only\" sends +8, + or the result, instead of the full sum. If the test shows nothing, change the text prefix to #.")
                }

                Section {
                    TextField("Channel", text: $model.topic)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .disabled(model.running)
                    TextField("Lock screen title", text: $model.title)
                        .disabled(model.running)
                    Toggle("Keep running in background", isOn: $model.keepAlive)
                        .disabled(model.running)
                    Toggle("Open the Island on each peek", isOn: $model.popOpen)
                } header: {
                    Text("Settings")
                } footer: {
                    Text("The channel must be the same as in the calculator (default fvt-c-k27x9m4q8w). \"Keep running in background\" plays silence so iOS does not stop the app. \"Open the Island on each peek\" expands the Dynamic Island for a moment and can make a sound.")
                }

                Section("Last peeks") {
                    if model.log.isEmpty {
                        Text("Nothing yet").foregroundStyle(.secondary)
                    }
                    ForEach(Array(model.log.enumerated()), id: \.offset) { item in
                        Text(item.element).font(.footnote.monospaced())
                    }
                }
            }
            .navigationTitle("Peek Island")
        }
    }
}
