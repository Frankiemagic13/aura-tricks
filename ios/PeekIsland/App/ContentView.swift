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
                    ForEach(PeekButton.all) { button in
                        ForEach(PeekGesture.all) { gesture in
                            Picker("\(button.name) – \(gesture.name)", selection: Binding(
                                get: { model.action(button.index, gesture.event) },
                                set: { model.setAction($0, button.index, gesture.event) }
                            )) {
                                ForEach(PeekAction.allCases) { a in Text(a.title).tag(a) }
                            }
                        }
                    }
                    if !ps.lastButton.isEmpty {
                        Text("Last button: \(ps.lastButton)").font(.caption).foregroundStyle(.secondary)
                    }
                } header: {
                    Text("PeekSmith buttons")
                } footer: {
                    Text("Tap = short press. Hold = keep pressed for 1 second. \"Last input\" is the last number the spectator typed, or the result after =. \"Previous peek\" steps back one peek each time.")
                }

                Section {
                    TextField("Inject ID", text: $model.injectID)
                        .keyboardType(.numberPad)
                    TextField("Inject URL", text: $model.injectURL, axis: .vertical)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.footnote.monospaced())
                    Toggle("Send text as POST field", isOn: $model.injectPOST)
                    if model.injectPOST {
                        TextField("Field name", text: $model.injectKey)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                    Button("Use Inject default address") {
                        model.injectURL = PeekModel.injectDefaultURL
                        model.injectPOST = true
                        model.injectKey = "value"
                    }
                    Button("Send test to Inject") { model.sendToInject("Test") }
                    if !model.injectStatus.isEmpty {
                        Text(model.injectStatus).font(.caption).foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Inject")
                } footer: {
                    Text("Default: https://11z.co/_w/{id}/selection with the text in the POST field \"value\". {id} is your Inject ID. For a different address, use {text} where the text goes in the address, or turn on the POST field.")
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
