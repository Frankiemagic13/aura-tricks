import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: PeekModel

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
