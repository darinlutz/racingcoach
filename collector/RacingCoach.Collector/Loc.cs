using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;

namespace RacingCoach.Collector;

/// <summary>
/// The overlays' text in the user's Preferred Language (<see cref="CollectorEngine.Language"/>): English, Brazilian
/// Portuguese, Latin American Spanish or German, in the website's words (src/lib/i18n/dictionaries). In XAML, Loc.Key on a
/// TextBlock, Run or Button names its text and Loc.ToolTip its tooltip, which <see cref="Apply"/> sets; in code,
/// <see cref="T(string, string)"/>. Numbers are formatted with the language's <see cref="Culture"/>.
/// </summary>
internal static class Loc
{
    public const string English = "en";

    /// <summary>"pt", "es" or "de", or English for anything else (e.g. a site from before the language was sent).</summary>
    public static string Normalize(string? language) => language is "pt" or "es" or "de" ? language : English;

    /// <summary>Number formatting: Brazilian Portuguese, Latin American Spanish and German, as on the website; English stays
    /// invariant, as the overlays always were.</summary>
    public static CultureInfo Culture(string language) => language switch
    {
        "pt" => Pt,
        "es" => Es,
        "de" => De,
        _ => CultureInfo.InvariantCulture,
    };

    private static readonly CultureInfo Pt = CultureInfo.GetCultureInfo("pt-BR");
    private static readonly CultureInfo Es = CultureInfo.GetCultureInfo("es-419");
    private static readonly CultureInfo De = CultureInfo.GetCultureInfo("de-DE");

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
            "de" => texts.De,
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

    // ---- The texts: English, Portuguese, Spanish, German ----

    private static readonly Dictionary<string, (string En, string Pt, string Es, string De)> Texts = new()
    {
        // Shared
        ["close"] = ("Close", "Fechar", "Cerrar", "Schließen"),
        ["reload"] = ("Reload", "Recarregar", "Recargar", "Neu laden"),
        ["reloadTip"] = ("Load your Target Lap again (after changing it in Debrief Coach)",
            "Carregar sua Volta Alvo de novo (depois de mudá-la no Debrief Coach)",
            "Cargar tu Vuelta Objetivo de nuevo (después de cambiarla en Debrief Coach)",
            "Deine Zielrunde neu laden (nachdem du sie im Debrief Coach geändert hast)"),
        ["waitingForIRacing"] = ("Waiting for iRacing…", "Aguardando o iRacing…", "Esperando iRacing…", "Warten auf iRacing…"),
        ["live"] = ("Live", "Ao vivo", "En vivo", "Live"),
        ["car"] = ("car", "carro", "auto", "Auto"),
        ["left"] = ("L", "E", "I", "L"),
        ["right"] = ("R", "D", "D", "R"),
        ["understeer"] = ("UNDERSTEER", "SUBESTERÇO", "SUBVIRAJE", "UNTERSTEUERN"),
        ["oversteer"] = ("OVERSTEER", "SOBRESTERÇO", "SOBREVIRAJE", "ÜBERSTEUERN"),
        ["neutral"] = ("NEUTRAL", "NEUTRO", "NEUTRO", "NEUTRAL"),
        ["unknown"] = ("UNKNOWN", "DESCONHECIDO", "DESCONOCIDO", "UNBEKANNT"),

        // Overlay boxes (OverlayStats, OverlayAreaRow, OverlayFeed)
        ["overlay.maxBrake"] = ("Max Brake", "Freio máx.", "Freno máx.", "Max. Bremse"),
        ["overlay.minSpeed"] = ("Min Speed ({0})", "Vel. mínima ({0})", "Vel. mínima ({0})", "Min. Tempo ({0})"),
        ["overlay.focusArea"] = ("Area", "Área", "Zona", "Bereich"),
        ["overlay.nextArea"] = ("Next Area", "Próxima área", "Próxima zona", "Nächster Bereich"),
        ["overlay.brakePoint"] = ("Brake Point", "Ponto de frenagem", "Punto de frenado", "Bremspunkt"),
        ["overlay.brakePressure"] = ("Brake Pressure", "Pressão de freio", "Presión de freno", "Bremsdruck"),
        ["overlay.time"] = ("Area Time", "Tempo na área", "Tiempo en zona", "Bereichszeit"),
        ["overlay.exit"] = ("Area Exit", "Saída da área", "Salida de zona", "Bereichsausgang"),
        ["overlay.coast"] = ("Coast", "Inércia", "Inercia", "Rollen"),
        ["overlay.overlap"] = ("Overlap", "Sobreposição", "Superposición", "Überlappung"),
        ["overlay.loading"] = ("Loading your focus areas…", "Carregando suas áreas de foco…", "Cargando tus zonas de enfoque…",
            "Deine Fokusbereiche werden geladen…"),
        ["overlay.noKey"] = ("Enter your upload key in the collector (Upload Key) to load your focus areas.",
            "Informe sua chave de envio no coletor (Upload Key) para carregar suas áreas de foco.",
            "Ingresa tu clave de carga en el colector (Upload Key) para cargar tus zonas de enfoque.",
            "Gib deinen Upload-Schlüssel im Collector ein (Upload Key), um deine Fokusbereiche zu laden."),
        ["overlay.noTrack"] = ("{0} isn't in your Track Data on RacingCoach.app. Add it there with its focus areas.",
            "{0} não está nos seus Dados de pistas no RacingCoach.app. Adicione-a lá com suas áreas de foco.",
            "{0} no está en tus Datos de pistas en RacingCoach.app. Agrégala allí con sus zonas de enfoque.",
            "{0} ist nicht in deinen Streckendaten auf RacingCoach.app. Füge die Strecke dort mit ihren Fokusbereichen hinzu."),
        ["overlay.keyRefused"] = ("RacingCoach.app doesn't accept your upload key. Enter your current one in the collector.",
            "O RacingCoach.app não aceita sua chave de envio. Informe a atual no coletor.",
            "RacingCoach.app no acepta tu clave de carga. Ingresa la actual en el colector.",
            "RacingCoach.app akzeptiert deinen Upload-Schlüssel nicht. Gib den aktuellen im Collector ein."),
        ["overlay.noTargetLap"] = ("No Target Lap: Brake Point, Brake Pressure and throttle targets come from it. Select a Target Lap in Debrief Coach at RacingCoach.app, then press Reload.",
            "Nenhuma Volta Alvo: os alvos de Ponto de frenagem, Pressão de freio e acelerador vêm dela. Selecione uma Volta Alvo no Debrief Coach do RacingCoach.app e pressione Recarregar.",
            "No hay Vuelta Objetivo: los objetivos de Punto de frenado, Presión de freno y acelerador salen de ella. Selecciona una Vuelta Objetivo en Debrief Coach de RacingCoach.app y pulsa Recargar.",
            "Keine Zielrunde: Die Ziele für Bremspunkt, Bremsdruck und Gas stammen aus ihr. Wähle im Debrief Coach auf RacingCoach.app eine Zielrunde aus und klicke dann auf Neu laden."),
        ["overlay.targetLapOtherTrack"] = ("Your Target Lap is from another track, so there are no Brake Point, Brake Pressure or throttle targets. Select a Target Lap of this track in Debrief Coach at RacingCoach.app, then press Reload.",
            "Sua Volta Alvo é de outra pista, então não há alvos de Ponto de frenagem, Pressão de freio ou acelerador. Selecione uma Volta Alvo desta pista no Debrief Coach do RacingCoach.app e pressione Recarregar.",
            "Tu Vuelta Objetivo es de otra pista, así que no hay objetivos de Punto de frenado, Presión de freno ni acelerador. Selecciona una Vuelta Objetivo de esta pista en Debrief Coach de RacingCoach.app y pulsa Recargar.",
            "Deine Zielrunde stammt von einer anderen Strecke, daher gibt es keine Ziele für Bremspunkt, Bremsdruck oder Gas. Wähle im Debrief Coach auf RacingCoach.app eine Zielrunde dieser Strecke aus und klicke dann auf Neu laden."),
        ["overlay.unreachable"] = ("Couldn't reach RacingCoach.app to load your focus areas ({0}). Trying again shortly.",
            "Não foi possível acessar o RacingCoach.app para carregar suas áreas de foco ({0}). Tentando de novo em instantes.",
            "No se pudo acceder a RacingCoach.app para cargar tus zonas de enfoque ({0}). Se intentará de nuevo en breve.",
            "RacingCoach.app war nicht erreichbar, um deine Fokusbereiche zu laden ({0}). Neuer Versuch in Kürze."),

        // TelemetryEngine.js's words (OverlayEngine.Localize)
        ["script.late"] = ("late", "depois", "más tarde", "später"),
        ["script.early"] = ("early", "antes", "antes", "früher"),
        ["script.NAILED"] = ("NAILED", "PERFEITO", "PERFECTO", "PERFEKT"),
        ["script.Target"] = ("Target", "Alvo", "Objetivo", "Ziel"),
        ["script.HEAVY"] = ("HEAVY", "FORTE", "FUERTE", "STARK"),
        ["script.light"] = ("light", "leve", "ligero", "leicht"),
        ["script.SAME"] = ("SAME", "IGUAL", "IGUAL", "GLEICH"),
        ["script.BEST"] = ("BEST", "MELHOR", "MEJOR", "BESTE"),
        ["script.TGT"] = ("TGT", "ALVO", "OBJ", "ZIEL"),

        // Rotation window
        ["rotation.title"] = (" ROTATION", " ROTAÇÃO", " ROTACIÓN", " ROTATION"),
        ["rotation.handling"] = ("Handling", "Comportamento", "Comportamiento", "Fahrverhalten"),
        ["rotation.severity"] = ("Severity (how much)", "Intensidade (quanto)", "Intensidad (cuánto)", "Stärke (wie viel)"),
        ["rotation.confidence"] = ("Confidence (how sure)", "Confiança (quão certo)", "Confianza (qué tan seguro)",
            "Sicherheit (wie sicher)"),
        ["rotation.understeerLeft"] = ("◀ UNDERSTEER", "◀ SUBESTERÇO", "◀ SUBVIRAJE", "◀ UNTERSTEUERN"),
        ["rotation.oversteerRight"] = ("OVERSTEER ▶", "SOBRESTERÇO ▶", "SOBREVIRAJE ▶", "ÜBERSTEUERN ▶"),
        ["rotation.sideslip"] = ("Sideslip", "Ângulo de deriva", "Ángulo de deriva", "Schwimmwinkel"),
        ["rotation.yawRatio"] = ("Yaw Rate vs Expected", "Guinada vs esperada", "Guiñada vs esperada", "Gierrate zu Sollwert"),
        ["rotation.understeerHeading"] = ("Understeer", "Subesterço", "Subviraje", "Untersteuern"),
        ["rotation.oversteerHeading"] = ("Oversteer", "Sobresterço", "Sobreviraje", "Übersteuern"),
        ["rotation.steering"] = ("Steering Wheel Angle", "Ângulo do volante", "Ángulo del volante", "Lenkradwinkel"),
        ["rotation.speed"] = ("Speed", "Velocidade", "Velocidad", "Tempo"),
        ["rotation.yawRate"] = ("Yaw Rate", "Taxa de guinada", "Tasa de guiñada", "Gierrate"),
        ["rotation.yaw"] = ("Yaw", "Guinada", "Guiñada", "Gierwinkel"),
        ["rotation.velocityX"] = ("Velocity X (forward)", "Velocidade X (frente)", "Velocidad X (adelante)",
            "Geschwindigkeit X (vorwärts)"),
        ["rotation.velocityY"] = ("Velocity Y (sideways)", "Velocidade Y (lateral)", "Velocidad Y (lateral)",
            "Geschwindigkeit Y (seitlich)"),
        ["rotation.latAccel"] = ("Lateral Accel", "Acel. lateral", "Acel. lateral", "Querbeschl."),
        ["rotation.longAccel"] = ("Longitudinal Accel", "Acel. longitudinal", "Acel. longitudinal", "Längsbeschl."),
        ["rotation.throttle"] = ("Throttle", "Acelerador", "Acelerador", "Gas"),
        ["rotation.brake"] = ("Brake", "Freio", "Freno", "Bremse"),
        ["rotation.percentOversteer"] = ("{0:0}% oversteer", "{0:0}% sobresterço", "{0:0}% sobreviraje", "{0:0} % Übersteuern"),
        ["rotation.percentUndersteer"] = ("{0:0}% understeer", "{0:0}% subesterço", "{0:0}% subviraje", "{0:0} % Untersteuern"),
        ["rotation.neutral"] = ("neutral", "neutro", "neutro", "neutral"),
        ["rotation.unknownBecause"] = ("UNKNOWN: {0}", "DESCONHECIDO: {0}", "DESCONOCIDO: {0}", "UNBEKANNT: {0}"),
        ["rotation.yawAndSideslip"] = ("yaw + sideslip", "guinada + deriva", "guiñada + deriva", "Gieren + Schwimmwinkel"),
        ["rotation.yawOnly"] = ("yaw only", "só guinada", "solo guiñada", "nur Gieren"),
        ["rotation.noCalibration"] = ("no calibration for this car", "sem calibração para este carro", "sin calibración para este auto",
            "keine Kalibrierung für dieses Auto"),
        ["rotation.thisSession"] = ("This session: {0} understeer, {1} oversteer", "Nesta sessão: {0} subesterço, {1} sobresterço",
            "En esta sesión: {0} subviraje, {1} sobreviraje",
            "Diese Session: {0} Untersteuern, {1} Übersteuern"),
        ["rotation.ofExpected"] = ("{0:0.0} of {1:0.0} °/s", "{0:0.0} de {1:0.0} °/s", "{0:0.0} de {1:0.0} °/s",
            "{0:0.0} von {1:0.0} °/s"),
        ["rotation.confidenceSeverity"] = ("confidence · severity {0:0}", "confiança · intensidade {0:0}", "confianza · intensidad {0:0}",
            "Sicherheit · Stärke {0:0}"),
        ["phase.ENTRY"] = ("ENTRY", "ENTRADA", "ENTRADA", "EINGANG"),
        ["phase.MID_CORNER"] = ("MID-CORNER", "MEIO DA CURVA", "MEDIO DE CURVA", "KURVENMITTE"),
        ["phase.EXIT"] = ("EXIT", "SAÍDA", "SALIDA", "AUSGANG"),
        ["phase.POWER_ON"] = ("POWER ON", "NA ACELERAÇÃO", "AL ACELERAR", "AM GAS"),
        ["reason.warming-up"] = ("warming up", "aquecendo", "calentando", "wärmt sich auf"),
        ["reason.low-speed"] = ("low speed", "velocidade baixa", "velocidad baja", "niedriges Tempo"),
        ["reason.reversing"] = ("reversing", "em marcha à ré", "en reversa", "Rückwärtsfahrt"),
        ["reason.uncalibrated"] = ("no calibration", "sem calibração", "sin calibración", "keine Kalibrierung"),
        ["reason.outside-calibrated-range"] = ("outside the calibrated range", "fora da faixa calibrada", "fuera del rango calibrado",
            "außerhalb des kalibrierten Bereichs"),
        ["reason.disturbance"] = ("disturbance", "perturbação", "perturbación", "Störung"),
        ["reason.inconsistent-lateral-acceleration"] = ("inconsistent lateral acceleration", "aceleração lateral inconsistente",
            "aceleración lateral inconsistente",
            "unplausible Querbeschleunigung"),
        ["reason.missing-time"] = ("no session time", "sem tempo de sessão", "sin tiempo de sesión", "keine Sessionzeit"),
        ["reason.not-driving"] = ("not driving", "não está pilotando", "no está conduciendo", "fährt nicht"),
        ["reason.missing-telemetry"] = ("missing telemetry", "telemetria ausente", "falta telemetría", "Telemetrie fehlt"),

        // Brake Practice window
        ["brake.title"] = (" BRAKE PRACTICE", " TREINO DE FRENAGEM", " PRÁCTICA DE FRENADO", " BREMSTRAINING"),
        ["brake.recalibrate"] = ("Recalibrate", "Recalibrar", "Recalibrar", "Neu kalibrieren"),
        ["brake.looking"] = ("Looking for your Simucube pedals…", "Procurando seus pedais Simucube…", "Buscando tus pedales Simucube…",
            "Deine Simucube-Pedale werden gesucht…"),
        ["brake.disconnected"] = ("Pedals disconnected. Plug them back in.", "Pedais desconectados. Conecte-os de novo.",
            "Pedales desconectados. Vuelve a conectarlos.",
            "Pedale getrennt. Schließe sie wieder an."),
        ["brake.noPedals"] = ("No pedals found. Plug in your Simucube pedals.", "Nenhum pedal encontrado. Conecte seus pedais Simucube.",
            "No se encontraron pedales. Conecta tus pedales Simucube.",
            "Keine Pedale gefunden. Schließe deine Simucube-Pedale an."),
        ["brake.calibrate"] = ("Calibrate pedal", "Calibrar pedal", "Calibrar pedal", "Pedal kalibrieren"),
        ["brake.pressTwice"] = ("Press the brake fully down twice.", "Pise no freio até o fundo duas vezes.",
            "Pisa el freno a fondo dos veces.",
            "Tritt die Bremse zweimal voll durch."),
        ["brake.pressTwiceReading"] = ("Press the brake fully down twice. (Reading {0}, {1} axis)",
            "Pise no freio até o fundo duas vezes. (Lendo {0}, eixo {1})",
            "Pisa el freno a fondo dos veces. (Leyendo {0}, eje {1})",
            "Tritt die Bremse zweimal voll durch. ({0} wird gelesen, Achse {1})"),
        ["brake.position"] = ("Position", "Posição", "Posición", "Position"),
        ["brake.press1"] = ("Press 1", "Pisada 1", "Pisada 1", "Tritt 1"),
        ["brake.press2"] = ("Press 2", "Pisada 2", "Pisada 2", "Tritt 2"),
        ["brake.complete"] = ("Calibration complete", "Calibração concluída", "Calibración completa", "Kalibrierung abgeschlossen"),
        ["brake.start"] = ("Start", "Iniciar", "Iniciar", "Start"),
        ["brake.playAgain"] = ("Play Again", "Jogar de novo", "Jugar de nuevo", "Nochmal spielen"),
        ["brake.startTip"] = ("Practice three braking zones from your Target Lap, three times through, with the beeps",
            "Treine três zonas de frenagem da sua Volta Alvo, três vezes seguidas, com os bipes",
            "Practica tres zonas de frenada de tu Vuelta Objetivo, tres veces seguidas, con los pitidos",
            "Übe drei Bremszonen aus deiner Zielrunde, dreimal hintereinander, mit den Pieptönen"),
        ["brake.playAgainPrompt"] = ("Done! Want to play again?", "Pronto! Quer jogar de novo?", "¡Listo! ¿Quieres jugar de nuevo?",
            "Fertig! Nochmal spielen?"),
        ["brake.finalScore"] = ("Final score: {0}%\nWant to play again?", "Pontuação final: {0}%\nQuer jogar de novo?",
            "Puntuación final: {0}%\n¿Quieres jugar de nuevo?",
            "Endergebnis: {0} %\nNochmal spielen?"),
        ["brake.score"] = ("Score", "Pontuação", "Puntuación", "Ergebnis"),
        ["brake.noZones"] = ("Your Target Lap has no heavy or medium braking zones.",
            "Sua Volta Alvo não tem zonas de frenagem fortes ou médias.",
            "Tu Vuelta Objetivo no tiene zonas de frenada fuertes o medias.",
            "Deine Zielrunde hat keine starken oder mittleren Bremszonen."),
        ["brake.run"] = ("Run {0} of {1}", "Rodada {0} de {1}", "Ronda {0} de {1}", "Durchgang {0} von {1}"),
        ["brake.heavy"] = ("Heavy braking", "Frenagem forte", "Frenada fuerte", "Starke Bremsung"),
        ["brake.medium"] = ("Medium braking", "Frenagem média", "Frenada media", "Mittlere Bremsung"),

        // Target Telemetry window (and TargetLapSource)
        ["target.telemetryTitle"] = (" TARGET TELEMETRY", " TELEMETRIA ALVO", " TELEMETRÍA OBJETIVO", " ZIEL-TELEMETRIE"),
        ["target.brake"] = ("target brake", "freio alvo", "freno objetivo", "Ziel-Bremse"),
        ["target.target"] = ("target", "alvo", "objetivo", "Ziel"),
        ["target.you"] = ("you", "você", "tú", "du"),
        ["target.noKey"] = ("Enter an upload key (Upload Key in the main window) to load your Target Lap.",
            "Informe uma chave de envio (Upload Key na janela principal) para carregar sua Volta Alvo.",
            "Ingresa una clave de carga (Upload Key en la ventana principal) para cargar tu Vuelta Objetivo.",
            "Gib einen Upload-Schlüssel ein (Upload Key im Hauptfenster), um deine Zielrunde zu laden."),
        ["target.loadFailed"] = ("Couldn't load your Target Lap ({0}). Trying again shortly.",
            "Não foi possível carregar sua Volta Alvo ({0}). Tentando de novo em instantes.",
            "No se pudo cargar tu Vuelta Objetivo ({0}). Se intentará de nuevo en breve.",
            "Deine Zielrunde konnte nicht geladen werden ({0}). Neuer Versuch in Kürze."),
        ["target.loadFailedShort"] = ("Couldn't load your Target Lap.", "Não foi possível carregar sua Volta Alvo.",
            "No se pudo cargar tu Vuelta Objetivo.",
            "Deine Zielrunde konnte nicht geladen werden."),
        ["target.loading"] = ("Loading your Target Lap…", "Carregando sua Volta Alvo…", "Cargando tu Vuelta Objetivo…",
            "Deine Zielrunde wird geladen…"),
        ["target.none"] = ("No Target Lap. Set one in Debrief Coach at RacingCoach.app.",
            "Nenhuma Volta Alvo. Defina uma no Debrief Coach do RacingCoach.app.",
            "No hay Vuelta Objetivo. Define una en Debrief Coach de RacingCoach.app.",
            "Keine Zielrunde. Lege im Debrief Coach auf RacingCoach.app eine fest."),
        ["target.otherTrack"] = ("Your Target Lap is from {0}, not {1}.", "Sua Volta Alvo é de {0}, não de {1}.",
            "Tu Vuelta Objetivo es de {0}, no de {1}.",
            "Deine Zielrunde stammt von {0}, nicht von {1}."),
        ["target.waitingForTrack"] = ("Waiting for iRacing's track…", "Aguardando a pista do iRacing…", "Esperando la pista de iRacing…",
            "Warten auf die Strecke von iRacing…"),
        ["target.waitingForIRacing"] = ("Waiting for iRacing… · {0}", "Aguardando o iRacing… · {0}", "Esperando iRacing… · {0}",
            "Warten auf iRacing… · {0}"),
        ["target.waitingForCar"] = ("Waiting for the car to be on track…", "Aguardando o carro estar na pista…",
            "Esperando que el auto esté en pista…",
            "Warten, bis das Auto auf der Strecke ist…"),
    };
}
