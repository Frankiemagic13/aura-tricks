import CoreBluetooth
import Foundation

/// Bluetooth link to a PeekSmith (Electricks protocol: service FFE0, text characteristic FFE1).
/// Commands are UTF-8 text that ends with "\n", written in parts of max. 19 bytes, about 200 ms apart.
final class PeekSmithLink: NSObject, ObservableObject {
    // Settings (saved)
    @Published var enabled: Bool { didSet { save() } }
    @Published var prefix: String { didSet { save() } }          // "$" (iOS docs) or "#"
    @Published var vibrate: Bool { didSet { save() } }
    @Published var shortOnly: Bool { didSet { save() } }         // send the short peek, not the full sum

    // State
    @Published private(set) var status = "Off"
    @Published private(set) var deviceName = ""
    @Published private(set) var connected = false
    @Published private(set) var lastReply = ""

    private static let service = CBUUID(string: "FFE0")
    private static let textChar = CBUUID(string: "FFE1")
    private static let debugService = CBUUID(string: "FFFF")

    private var central: CBCentralManager!
    private var peripheral: CBPeripheral?
    private var characteristic: CBCharacteristic?
    private var queue: [Data] = []
    private var writing = false
    private var wantConnection = false

    override init() {
        let d = UserDefaults.standard
        enabled = d.object(forKey: "ps.enabled") as? Bool ?? true
        prefix = d.string(forKey: "ps.prefix") ?? "$"
        vibrate = d.object(forKey: "ps.vibrate") as? Bool ?? false
        shortOnly = d.object(forKey: "ps.short") as? Bool ?? false
        super.init()
        central = CBCentralManager(
            delegate: self, queue: .main,
            options: [CBCentralManagerOptionRestoreIdentifierKey: "PeekIslandCentral"]
        )
    }

    private func save() {
        let d = UserDefaults.standard
        d.set(enabled, forKey: "ps.enabled")
        d.set(prefix, forKey: "ps.prefix")
        d.set(vibrate, forKey: "ps.vibrate")
        d.set(shortOnly, forKey: "ps.short")
    }

    private var savedID: UUID? {
        get { UserDefaults.standard.string(forKey: "ps.id").flatMap(UUID.init(uuidString:)) }
        set { UserDefaults.standard.set(newValue?.uuidString, forKey: "ps.id") }
    }

    // MARK: Public

    /// Finds and connects the PeekSmith. Works also when the PeekSmith app is connected,
    /// because iOS shares one Bluetooth connection between apps.
    func connect() {
        wantConnection = true
        guard central.state == .poweredOn else {
            status = central.state == .unauthorized ? "Bluetooth not allowed (Settings → Peek Island)" : "Waiting for Bluetooth…"
            return
        }
        if let p = peripheral, p.state == .connected { return }

        // 1. A PeekSmith that is already connected to the iPhone (for example by the PeekSmith app)
        let systemConnected = central.retrieveConnectedPeripherals(withServices: [Self.service])
        if let p = systemConnected.first(where: { ($0.name ?? "").hasPrefix("PeekSmith") }) ?? systemConnected.first {
            status = "Found (already connected to iPhone)"
            open(p)
            return
        }
        // 2. The PeekSmith used last time
        if let id = savedID, let p = central.retrievePeripherals(withIdentifiers: [id]).first {
            status = "Connecting to last PeekSmith…"
            open(p)
            // Also scan, in case it is not in range with the old identity
        }
        // 3. Scan
        status = "Searching… (turn the PeekSmith on)"
        central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    }

    func disconnect() {
        wantConnection = false
        central.stopScan()
        if let p = peripheral { central.cancelPeripheralConnection(p) }
        peripheral = nil
        characteristic = nil
        connected = false
        status = "Disconnected"
    }

    func forget() {
        disconnect()
        savedID = nil
        deviceName = ""
        status = "Forgotten"
    }

    /// Shows text on the PeekSmith.
    func send(_ text: String) {
        guard enabled else { return }
        // The PeekSmith font is ASCII: change special signs
        let clean = text
            .replacingOccurrences(of: "−", with: "-")
            .replacingOccurrences(of: "×", with: "x")
            .replacingOccurrences(of: "÷", with: "/")
            .replacingOccurrences(of: "•", with: ".")
            .replacingOccurrences(of: "\n", with: " ")
        enqueue(prefix + clean + "\n")
        if vibrate { enqueue("~.\n") }
    }

    func test() { send("Test 123") }

    // MARK: Writing

    private func enqueue(_ command: String) {
        guard let data = command.data(using: .utf8) else { return }
        var i = 0
        while i < data.count {
            let end = min(i + 19, data.count)
            queue.append(data.subdata(in: i..<end))
            i = end
        }
        queue.append(Data()) // empty = pause of 200 ms between commands
        pump()
    }

    private func pump() {
        guard !writing, !queue.isEmpty else { return }
        guard let p = peripheral, p.state == .connected, let c = characteristic else {
            // Keep only the newest command when not connected
            if queue.count > 40 { queue.removeFirst(queue.count - 40) }
            return
        }
        writing = true
        let part = queue.removeFirst()
        if part.isEmpty {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                self?.writing = false
                self?.pump()
            }
            return
        }
        let type: CBCharacteristicWriteType = c.properties.contains(.writeWithoutResponse) ? .withoutResponse : .withResponse
        p.writeValue(part, for: c, type: type)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.03) { [weak self] in
            self?.writing = false
            self?.pump()
        }
    }

    // MARK: Connection helpers

    private func open(_ p: CBPeripheral) {
        peripheral = p
        p.delegate = self
        deviceName = p.name ?? "PeekSmith"
        if p.state == .connected {
            p.discoverServices([Self.service, Self.debugService])
        } else {
            central.connect(p, options: nil)
        }
    }
}

// MARK: - CBCentralManagerDelegate

extension PeekSmithLink: CBCentralManagerDelegate {
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:
            status = "Bluetooth on"
            if enabled && (wantConnection || savedID != nil) { connect() }
        case .poweredOff: status = "Bluetooth is off"; connected = false
        case .unauthorized: status = "Bluetooth not allowed (Settings → Peek Island)"
        case .unsupported: status = "No Bluetooth LE"
        default: status = "Waiting for Bluetooth…"
        }
    }

    func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        if let ps = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral], let p = ps.first {
            wantConnection = true
            open(p)
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover p: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let name = p.name ?? (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? ""
        let services = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? []
        guard name.hasPrefix("PeekSmith") || services.contains(Self.service) else { return }
        central.stopScan()
        status = "Connecting to \(name.isEmpty ? "PeekSmith" : name)…"
        open(p)
    }

    func centralManager(_ central: CBCentralManager, didConnect p: CBPeripheral) {
        status = "Finding services…"
        p.discoverServices([Self.service, Self.debugService])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
        status = "Connect failed: \(error?.localizedDescription ?? "unknown")"
        connected = false
        if wantConnection {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.connect() }
        }
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
        connected = false
        characteristic = nil
        if wantConnection {
            status = "Lost connection – reconnecting…"
            central.connect(p, options: nil) // iOS reconnects when the PeekSmith comes back
        } else {
            status = "Disconnected"
        }
    }
}

// MARK: - CBPeripheralDelegate

extension PeekSmithLink: CBPeripheralDelegate {
    func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
        guard let services = p.services, !services.isEmpty else {
            status = "No services found: \(error?.localizedDescription ?? "")"
            return
        }
        guard services.contains(where: { $0.uuid == Self.service }) else {
            status = "This is not a PeekSmith (no FFE0 service)"
            return
        }
        for s in services { p.discoverCharacteristics(nil, for: s) }
    }

    func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        for c in service.characteristics ?? [] {
            // The Electricks docs: turn on notifications before you write commands
            if c.properties.contains(.notify) { p.setNotifyValue(true, for: c) }
            if service.uuid == Self.service && c.uuid == Self.textChar {
                characteristic = c
                connected = true
                savedID = p.identifier
                deviceName = p.name ?? "PeekSmith"
                status = "Connected"
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.pump() }
            }
        }
    }

    func peripheral(_ p: CBPeripheral, didUpdateValueFor c: CBCharacteristic, error: Error?) {
        if let v = c.value, let s = String(data: v, encoding: .utf8) {
            lastReply = s.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }
}
