import ActivityKit
import Foundation

/// Data for the Live Activity. Used by the app and by the widget extension.
struct PeekAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// Full peek, for example "12 + 34 + 56 + 8 taps"
        var full: String
        /// Short peek for the compact Dynamic Island, for example "+8"
        var short: String
        var updated: Date
    }

    /// Small title on the lock screen, for example "Peek"
    var title: String
}

enum PeekText {
    /// Makes the short text for the compact Dynamic Island.
    static func short(from full: String) -> String {
        let t = full.trimmingCharacters(in: .whitespaces)
        // "... + 8 taps"  ->  "+8"   /  "... - 8 taps" -> "−8"
        if t.hasSuffix("taps") {
            let parts = t.split(separator: " ")
            if parts.count >= 3 {
                let n = parts[parts.count - 2]
                let sign = parts[parts.count - 3]
                return (sign == "-" ? "−" : "+") + n
            }
        }
        // live sign peek "... (+)" / "... (-)"
        if t.hasSuffix("(+)") { return "+" }
        if t.hasSuffix("(-)") { return "−" }
        // result "... = 11,090,551"
        if let r = t.range(of: " = ", options: .backwards) {
            return String(t[r.upperBound...])
        }
        // otherwise the last number
        if let last = t.split(separator: " ").last { return String(last) }
        return t
    }
}
