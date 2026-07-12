import WidgetKit
import SwiftUI

@main
struct GastosDiariosWidgetBundle: WidgetBundle {
    var body: some Widget {
        BudgetWidget()
        // Controls are iOS 18+; the bundle still targets iOS 17.
        if #available(iOSApplicationExtension 18.0, *) {
            QuickEntryControl()
        }
    }
}

/// Control Center / Lock Screen / Action button control that launches the
/// shared QuickEntryIntent (compiled into both targets; in this process it
/// leaves an app-group flag and openAppWhenRun foregrounds the app).
@available(iOSApplicationExtension 18.0, *)
struct QuickEntryControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "dev.cardozo.gastosdiarios.quickentry") {
            ControlWidgetButton(action: QuickEntryIntent()) {
                Label("Registrar gasto", systemImage: "plus.circle.fill")
            }
        }
        .displayName("Registrar gasto")
        .description("Abre la carga rápida de gastos.")
    }
}
