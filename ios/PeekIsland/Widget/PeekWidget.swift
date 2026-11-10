import ActivityKit
import SwiftUI
import WidgetKit

@main
struct PeekWidgetBundle: WidgetBundle {
    var body: some Widget {
        PeekLiveActivity()
    }
}

struct PeekLiveActivity: Widget {
    private let accent = Color(red: 0.95, green: 0.64, blue: 0.24)

    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PeekAttributes.self) { context in
            // Lock screen and banner
            HStack(spacing: 12) {
                Image(systemName: "plus.forwardslash.minus")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text(context.attributes.title)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(context.state.full)
                        .font(.headline)
                        .lineLimit(2)
                        .minimumScaleFactor(0.5)
                }
                Spacer(minLength: 8)
                Text(context.state.short)
                    .font(.title2.weight(.bold))
                    .monospacedDigit()
                    .foregroundStyle(accent)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
            }
            .padding(16)
            .activityBackgroundTint(Color.black.opacity(0.85))
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "plus.forwardslash.minus")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(accent)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.short)
                        .font(.title3.weight(.bold))
                        .monospacedDigit()
                        .foregroundStyle(accent)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.state.full)
                        .font(.headline)
                        .lineLimit(2)
                        .minimumScaleFactor(0.5)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            } compactLeading: {
                Image(systemName: "plus.forwardslash.minus")
                    .foregroundStyle(accent)
            } compactTrailing: {
                Text(context.state.short)
                    .font(.caption.weight(.bold))
                    .monospacedDigit()
                    .foregroundStyle(accent)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .frame(maxWidth: 64)
            } minimal: {
                Text(context.state.short)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(accent)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
            }
        }
    }
}
