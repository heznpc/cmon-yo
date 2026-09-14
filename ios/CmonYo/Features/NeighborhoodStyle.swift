import SwiftUI

// Same sampled accent as Web. Text uses a deeper shade in light appearance.
enum NeighborhoodStyle {
  static let accent = Color(red: 120 / 255, green: 147 / 255, blue: 248 / 255)
  static let accentInk = Color(red: 23 / 255, green: 38 / 255, blue: 76 / 255)
  static let link = Color(uiColor: UIColor { traits in
    traits.userInterfaceStyle == .dark
      ? UIColor(red: 152 / 255, green: 175 / 255, blue: 250 / 255, alpha: 1)
      : UIColor(red: 54 / 255, green: 85 / 255, blue: 179 / 255, alpha: 1)
  })
}
struct NeighborhoodIcon: View {
  let symbol: String
  var body: some View {
    Image(systemName: symbol).font(.system(size: 26, weight: .regular))
      .foregroundStyle(NeighborhoodStyle.link)
      .frame(width: 60, height: 60)
      .background(NeighborhoodStyle.accent.opacity(0.13), in: RoundedRectangle(cornerRadius: 14))
      .accessibilityHidden(true)
  }
}
struct NeighborhoodButton: ButtonStyle {
  @Environment(\.isEnabled) private var enabled
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.body.weight(.semibold))
      .frame(maxWidth: .infinity, minHeight: 48).padding(.horizontal, 16)
      .foregroundStyle(enabled ? NeighborhoodStyle.accentInk : Color.secondary)
      .background(enabled ? NeighborhoodStyle.accent : Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
      .opacity(configuration.isPressed ? 0.8 : 1)
  }
}
struct NeighborhoodToolbar: ToolbarContent {
  var body: some ToolbarContent {
    ToolbarItem(placement: .principal) {
      Text("C’mon Yo!").font(.headline.bold().italic()).foregroundStyle(NeighborhoodStyle.link)
    }
    ToolbarItem(placement: .topBarTrailing) {
      Label("내 위치", systemImage: "mappin").labelStyle(.titleAndIcon).font(.subheadline).foregroundStyle(.secondary).fixedSize()
    }
  }
}
