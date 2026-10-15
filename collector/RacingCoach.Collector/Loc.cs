using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;

namespace RacingCoach.Collector;

/// <summary>
/// The overlays' text in the user's Preferred Language (<see cref="CollectorEngine.Language"/>): English, Brazilian
/// Portuguese or Latin American Spanish, in the website's words (src/lib/i18n/dictionaries). In XAML, Loc.Key on a
/// TextBlock, Run or Button names its text and Loc.ToolTip its tooltip, which <see cref="Apply"/> sets; in code,
/// <see cref="T(string, string)"/>. Numbers are formatted with the language's <see cref="Culture"/>.
/// </summary>
internal static class Loc
{
    public const string English = "en";

    /// <summary>"pt" or "es", or English for anything else (e.g. a site from before the language was sent).</summary>
    public static string Normalize(string? language) => language is "pt" or "es" ? language : English;

    /// <summary>Number formatting: Brazilian Portuguese and Latin American Spanish, as on the website; English stays
    /// invariant, as the overlays always were.</summary>
    public static CultureInfo Culture(string language) => language switch
    {
        "pt" => Pt,
        "es" => Es,
        _ => CultureInfo.InvariantCulture,
    };

    private static readonly CultureInfo Pt = CultureInfo.GetCultureInfo("pt-BR");
    private static readonly CultureInfo Es = CultureInfo.GetCultureInfo("es-419");

    /// <summary>The text for a key in a language (English when the language has none; the key itself when no
    /// language has it).</summary>
    public static string T(string language, string key)
    {
        if (!Texts.TryGetValue(key, out var texts))
            return key;
        return language switch
        {
            "pt" => texts.Pt,
            "es" => texts.Es,
            _ => texts.En,
        };
    }

    /// <summary>The text for a key with {0}, {1}... filled in, numbers formatted for the language.</summary>
    public static string T(string language, string key, params object?[] args) =>
        string.Format(Culture(language), T(language, key), args);

    /// <summary>The speed unit for the user's Preferred Units.</summary>
    public static string SpeedUnit(bool metric) => metric ? "km/h" : "mph";

    /// <summary>The distance unit for the user's Preferred Units.</summary>
    public static string DistanceUnit(bool metric) => metric ? "m" : "ft";

    // ---- XAML ----

    public static readonly DependencyProperty KeyProperty =
        DependencyProperty.RegisterAttached("Key", typeof(string), typeof(Loc));
    public static string? GetKey(DependencyObject element) => (string?)element.GetValue(KeyProperty);
    public static void SetKey(DependencyObject element, string? value) => element.SetValue(KeyProperty, value);

    public static readonly DependencyProperty ToolTipProperty =
        DependencyProperty.RegisterAttached("ToolTip", typeof(string), typeof(Loc));
    public static string? GetToolTip(DependencyObject element) => (string?)element.GetValue(ToolTipProperty);
    public static void SetToolTip(DependencyObject element, string? value) => element.SetValue(ToolTipProperty, value);

    /// <summary>Sets the text of every element under root with a Loc.Key, and the tooltip of every one with a
    /// Loc.ToolTip, in the language.</summary>
    public static void Apply(DependencyObject root, string language)
    {
        if (GetKey(root) is { } key)
        {
            var text = T(language, key);
            switch (root)
            {
                case TextBlock block:
                    block.Text = text;
                    break;
                case Run run:
                    run.Text = text;
                    break;
                case ContentControl control:
                    control.Content = text;
                    break;
            }
        }
        if (GetToolTip(root) is { } toolTip && root is FrameworkElement element)
            element.ToolTip = T(language, toolTip);
        // A copy: setting a Run's text rebuilds its TextBlock's inlines, which ends the enumeration otherwise
        foreach (var child in LogicalTreeHelper.GetChildren(root).OfType<DependencyObject>().ToList())
            Apply(child, language);
    }

    // ---- The texts: English, Portuguese, Spanish ----

    private static readonly Dictionary<string, (string En, string Pt, string Es)> Texts = new()
    {
        // Shared
        ["close"] = ("Close", "Fechar", "Cerrar"),
        ["reload"] = ("Reload", "Recarregar", "Recargar"),
        ["reloadTip"] = ("Load your Target Lap again (after changing it on the Account page)",
            "Carregar sua Volta Alvo de novo (depois de mudá-la na página Conta)",
            "Cargar tu Vuelta Objetivo de nuevo (después de cambiarla en la página Cuenta)"),
        ["waitingForIRacing"] = ("Waiting for iRacing…", "Aguardando o iRacing…", "Esperando iRacing…"),
        ["live"] = ("Live", "Ao vivo", "En vivo"),
        ["car"] = ("car", "carro", "auto"),
        ["left"] = ("L", "E", "I"),
        ["right"] = ("R", "D", "D"),
        ["understeer"] = ("UNDERSTEER", "SUBESTERÇO", "SUBVIRAJE"),
        ["oversteer"] = ("OVERSTEER", "SOBRESTERÇO", "SOBREVIRAJE"),
        ["neutral"] = ("NEUTRAL", "NEUTRO", "NEUTRO"),
        ["unknown"] = ("UNKNOWN", "DESCONHECIDO", "DESCONOCIDO"),

        // Overlay (OverlayWindow)
        ["overlay.close"] = ("Close the overlay", "Fechar o overlay", "Cerrar el overlay"),
        ["overlay.maxBrake"] = ("Max Brake", "Freio máx.", "Freno máx."),
        ["overlay.minSpeed"] = ("Min Speed ({0})", "Vel. mínima ({0})", "Vel. mínima ({0})"),
        ["overlay.focusArea"] = ("Area", "Área", "Zona"),
        ["overlay.brakePoint"] = ("Brake Point", "Ponto de frenagem", "Punto de frenado"),
        ["overlay.brakePressure"] = ("Brake Pressure", "Pressão de freio", "Presión de freno"),
        ["overlay.time"] = ("Area Time", "Tempo na área", "Tiempo en zona"),
        ["overlay.exit"] = ("Area Exit", "Saída da área", "Salida de zona"),
        ["overlay.coast"] = ("Coast", "Inércia", "Inercia"),
        ["overlay.overlap"] = ("Overlap", "Sobreposição", "Superposición"),
        ["overlay.loading"] = ("Loading your focus areas…", "Carregando suas áreas de foco…", "Cargando tus zonas de enfoque…"),
        ["overlay.noKey"] = ("Enter your upload key in the collector (Upload Key) to load your focus areas.",
            "Informe sua chave de envio no coletor (Upload Key) para carregar suas áreas de foco.",
            "Ingresa tu clave de carga en el colector (Upload Key) para cargar tus zonas de enfoque."),
        ["overlay.noTrack"] = ("{0} isn't in your Track Data on RacingCoach.app. Add it there with its focus areas.",
            "{0} não está nos seus Dados de pistas no RacingCoach.app. Adicione-a lá com suas áreas de foco.",
            "{0} no está en tus Datos de pistas en RacingCoach.app. Agrégala allí con sus zonas de enfoque."),
        ["overlay.keyRefused"] = ("RacingCoach.app doesn't accept your upload key. Enter your current one in the collector.",
            "O RacingCoach.app não aceita sua chave de envio. Informe a atual no coletor.",
            "RacingCoach.app no acepta tu clave de carga. Ingresa la actual en el colector."),
        ["overlay.unreachable"] = ("Couldn't reach RacingCoach.app to load your focus areas ({0}). Trying again shortly.",
            "Não foi possível acessar o RacingCoach.app para carregar suas áreas de foco ({0}). Tentando de novo em instantes.",
            "No se pudo acceder a RacingCoach.app para cargar tus zonas de enfoque ({0}). Se intentará de nuevo en breve."),

        // TelemetryEngine.js's words (OverlayEngine.Localize)
        ["script.late"] = ("late", "depois", "más tarde"),
        ["script.early"] = ("early", "antes", "antes"),
        ["script.NAILED"] = ("NAILED", "PERFEITO", "PERFECTO"),
        ["script.Target"] = ("Target", "Alvo", "Objetivo"),
        ["script.HEAVY"] = ("HEAVY", "FORTE", "FUERTE"),
        ["script.light"] = ("light", "leve", "ligero"),
        ["script.SAME"] = ("SAME", "IGUAL", "IGUAL"),
        ["script.BEST"] = ("BEST", "MELHOR", "MEJOR"),
        ["script.TGT"] = ("TGT", "ALVO", "OBJ"),

        // Rotation window
        ["rotation.title"] = (" ROTATION", " ROTAÇÃO", " ROTACIÓN"),
        ["rotation.handling"] = ("Handling", "Comportamento", "Comportamiento"),
        ["rotation.severity"] = ("Severity (how much)", "Intensidade (quanto)", "Intensidad (cuánto)"),
        ["rotation.confidence"] = ("Confidence (how sure)", "Confiança (quão certo)", "Confianza (qué tan seguro)"),
        ["rotation.understeerLeft"] = ("◀ UNDERSTEER", "◀ SUBESTERÇO", "◀ SUBVIRAJE"),
        ["rotation.oversteerRight"] = ("OVERSTEER ▶", "SOBRESTERÇO ▶", "SOBREVIRAJE ▶"),
        ["rotation.sideslip"] = ("Sideslip", "Ângulo de deriva", "Ángulo de deriva"),
        ["rotation.yawRatio"] = ("Yaw Rate vs Expected", "Guinada vs esperada", "Guiñada vs esperada"),
        ["rotation.understeerHeading"] = ("Understeer", "Subesterço", "Subviraje"),
        ["rotation.oversteerHeading"] = ("Oversteer", "Sobresterço", "Sobreviraje"),
        ["rotation.steering"] = ("Steering Wheel Angle", "Ângulo do volante", "Ángulo del volante"),
        ["rotation.speed"] = ("Speed", "Velocidade", "Velocidad"),
        ["rotation.yawRate"] = ("Yaw Rate", "Taxa de guinada", "Tasa de guiñada"),
        ["rotation.yaw"] = ("Yaw", "Guinada", "Guiñada"),
        ["rotation.velocityX"] = ("Velocity X (forward)", "Velocidade X (frente)", "Velocidad X (adelante)"),
        ["rotation.velocityY"] = ("Velocity Y (sideways)", "Velocidade Y (lateral)", "Velocidad Y (lateral)"),
        ["rotation.latAccel"] = ("Lateral Accel", "Acel. lateral", "Acel. lateral"),
        ["rotation.longAccel"] = ("Longitudinal Accel", "Acel. longitudinal", "Acel. longitudinal"),
        ["rotation.throttle"] = ("Throttle", "Acelerador", "Acelerador"),
        ["rotation.brake"] = ("Brake", "Freio", "Freno"),
        ["rotation.percentOversteer"] = ("{0:0}% oversteer", "{0:0}% sobresterço", "{0:0}% sobreviraje"),
        ["rotation.percentUndersteer"] = ("{0:0}% understeer", "{0:0}% subesterço", "{0:0}% subviraje"),
        ["rotation.neutral"] = ("neutral", "neutro", "neutro"),
        ["rotation.unknownBecause"] = ("UNKNOWN: {0}", "DESCONHECIDO: {0}", "DESCONOCIDO: {0}"),
        ["rotation.yawAndSideslip"] = ("yaw + sideslip", "guinada + deriva", "guiñada + deriva"),
        ["rotation.yawOnly"] = ("yaw only", "só guinada", "solo guiñada"),
        ["rotation.noCalibration"] = ("no calibration for this car", "sem calibração para este carro", "sin calibración para este auto"),
        ["rotation.thisSession"] = ("This session: {0} understeer, {1} oversteer", "Nesta sessão: {0} subesterço, {1} sobresterço",
            "En esta sesión: {0} subviraje, {1} sobreviraje"),
        ["rotation.ofExpected"] = ("{0:0.0} of {1:0.0} °/s", "{0:0.0} de {1:0.0} °/s", "{0:0.0} de {1:0.0} °/s"),
        ["rotation.confidenceSeverity"] = ("confidence · severity {0:0}", "confiança · intensidade {0:0}", "confianza · intensidad {0:0}"),
        ["phase.ENTRY"] = ("ENTRY", "ENTRADA", "ENTRADA"),
        ["phase.MID_CORNER"] = ("MID-CORNER", "MEIO DA CURVA", "MEDIO DE CURVA"),
        ["phase.EXIT"] = ("EXIT", "SAÍDA", "SALIDA"),
        ["phase.POWER_ON"] = ("POWER ON", "NA ACELERAÇÃO", "AL ACELERAR"),
        ["reason.warming-up"] = ("warming up", "aquecendo", "calentando"),
        ["reason.low-speed"] = ("low speed", "velocidade baixa", "velocidad baja"),
        ["reason.reversing"] = ("reversing", "em marcha à ré", "en reversa"),
        ["reason.uncalibrated"] = ("no calibration", "sem calibração", "sin calibración"),
        ["reason.outside-calibrated-range"] = ("outside the calibrated range", "fora da faixa calibrada", "fuera del rango calibrado"),
        ["reason.disturbance"] = ("disturbance", "perturbação", "perturbación"),
        ["reason.inconsistent-lateral-acceleration"] = ("inconsistent lateral acceleration", "aceleração lateral inconsistente",
            "aceleración lateral inconsistente"),
        ["reason.missing-time"] = ("no session time", "sem tempo de sessão", "sin tiempo de sesión"),
        ["reason.not-driving"] = ("not driving", "não está pilotando", "no está conduciendo"),
        ["reason.missing-telemetry"] = ("missing telemetry", "telemetria ausente", "falta telemetría"),

        // Brake Practice window
        ["brake.title"] = (" BRAKE PRACTICE", " TREINO DE FRENAGEM", " PRÁCTICA DE FRENADO"),
        ["brake.recalibrate"] = ("Recalibrate", "Recalibrar", "Recalibrar"),
        ["brake.looking"] = ("Looking for your Simucube pedals…", "Procurando seus pedais Simucube…", "Buscando tus pedales Simucube…"),
        ["brake.disconnected"] = ("Pedals disconnected. Plug them back in.", "Pedais desconectados. Conecte-os de novo.",
            "Pedales desconectados. Vuelve a conectarlos."),
        ["brake.noPedals"] = ("No pedals found. Plug in your Simucube pedals.", "Nenhum pedal encontrado. Conecte seus pedais Simucube.",
            "No se encontraron pedales. Conecta tus pedales Simucube."),
        ["brake.calibrate"] = ("Calibrate pedal", "Calibrar pedal", "Calibrar pedal"),
        ["brake.pressTwice"] = ("Press the brake fully down twice.", "Pise no freio até o fundo duas vezes.",
            "Pisa el freno a fondo dos veces."),
        ["brake.pressTwiceReading"] = ("Press the brake fully down twice. (Reading {0}, {1} axis)",
            "Pise no freio até o fundo duas vezes. (Lendo {0}, eixo {1})",
            "Pisa el freno a fondo dos veces. (Leyendo {0}, eje {1})"),
        ["brake.position"] = ("Position", "Posição", "Posición"),
        ["brake.press1"] = ("Press 1", "Pisada 1", "Pisada 1"),
        ["brake.press2"] = ("Press 2", "Pisada 2", "Pisada 2"),
        ["brake.complete"] = ("Calibration complete", "Calibração concluída", "Calibración completa"),

        // Target Telemetry window (and TargetLapSource)
        ["target.telemetryTitle"] = (" TARGET TELEMETRY", " TELEMETRIA ALVO", " TELEMETRÍA OBJETIVO"),
        ["target.brake"] = ("target brake", "freio alvo", "freno objetivo"),
        ["target.target"] = ("target", "alvo", "objetivo"),
        ["target.you"] = ("you", "você", "tú"),
        ["target.inArea"] = ("In Area", "Na Área", "En el Área"),
        ["target.noKey"] = ("Enter an upload key (Upload Key in the main window) to load your Target Lap.",
            "Informe uma chave de envio (Upload Key na janela principal) para carregar sua Volta Alvo.",
            "Ingresa una clave de carga (Upload Key en la ventana principal) para cargar tu Vuelta Objetivo."),
        ["target.loadFailed"] = ("Couldn't load your Target Lap ({0}). Trying again shortly.",
            "Não foi possível carregar sua Volta Alvo ({0}). Tentando de novo em instantes.",
            "No se pudo cargar tu Vuelta Objetivo ({0}). Se intentará de nuevo en breve."),
        ["target.loadFailedShort"] = ("Couldn't load your Target Lap.", "Não foi possível carregar sua Volta Alvo.",
            "No se pudo cargar tu Vuelta Objetivo."),
        ["target.loading"] = ("Loading your Target Lap…", "Carregando sua Volta Alvo…", "Cargando tu Vuelta Objetivo…"),
        ["target.none"] = ("No Target Lap. Set one on the Account page at RacingCoach.app.",
            "Nenhuma Volta Alvo. Defina uma na página Conta do RacingCoach.app.",
            "No hay Vuelta Objetivo. Define una en la página Cuenta de RacingCoach.app."),
        ["target.otherTrack"] = ("Your Target Lap is from {0}, not {1}.", "Sua Volta Alvo é de {0}, não de {1}.",
            "Tu Vuelta Objetivo es de {0}, no de {1}."),
        ["target.waitingForTrack"] = ("Waiting for iRacing's track…", "Aguardando a pista do iRacing…", "Esperando la pista de iRacing…"),
        ["target.waitingForIRacing"] = ("Waiting for iRacing… · {0}", "Aguardando o iRacing… · {0}", "Esperando iRacing… · {0}"),
        ["target.waitingForCar"] = ("Waiting for the car to be on track…", "Aguardando o carro estar na pista…",
            "Esperando que el auto esté en pista…"),
    };
}
