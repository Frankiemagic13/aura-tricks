import Foundation

/// What a PeekSmith button does.
enum PeekAction: String, CaseIterable, Identifiable, Codable {
    case none
    case lastInput      // last number the spectator typed (or the result)
    case lastPeek       // full last peek, e.g. "12 + 34 + 56 + 8 taps"
    case shortPeek      // short peek, e.g. "+8"
    case previousPeek   // step back through earlier peeks
    case clear          // blank the PeekSmith screen
    case inject         // send the last input to Inject

    var id: String { rawValue }

    var title: String {
        switch self {
        case .none: return "Nothing"
        case .lastInput: return "Show last input"
        case .lastPeek: return "Show full last peek"
        case .shortPeek: return "Show short peek"
        case .previousPeek: return "Show previous peek"
        case .clear: return "Clear PeekSmith"
        case .inject: return "Send last input to Inject"
        }
    }
}

/// The three PeekSmith buttons (Electricks protocol: 0 = side, 1 = front left, 2 = front right).
struct PeekButton: Identifiable {
    let index: Int
    let name: String
    var id: Int { index }

    static let all = [
        PeekButton(index: 1, name: "Front left"),
        PeekButton(index: 2, name: "Front right"),
        PeekButton(index: 0, name: "Side"),
    ]
}

/// Button events used for actions: "click" (tap) and "longpress" (hold 1 s).
struct PeekGesture: Identifiable {
    let event: String
    let name: String
    var id: String { event }

    static let all = [
        PeekGesture(event: "click", name: "Tap"),
        PeekGesture(event: "longpress", name: "Hold"),
    ]
}

enum ButtonMap {
    static func key(_ button: Int, _ event: String) -> String { "\(button).\(event)" }

    static let defaults: [String: PeekAction] = [
        key(1, "click"): .lastInput,
        key(2, "click"): .inject,
        key(1, "longpress"): .previousPeek,
        key(2, "longpress"): .clear,
        key(0, "click"): .none,
        key(0, "longpress"): .none,
    ]
}
