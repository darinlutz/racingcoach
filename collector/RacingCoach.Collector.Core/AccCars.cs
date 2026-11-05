namespace RacingCoach.Collector.Simulators;

/// <summary>One of ACC's cars, from the appendices of Kunos's "ACC Shared Memory v1.8.12".</summary>
/// <param name="KunosId">The static page's carModel (Appendix 2).</param>
/// <param name="Name">The document's name, with its typing slips corrected ("Porsche9 91" is "Porsche 991").</param>
/// <param name="MaxSteeringAngleDegrees">Appendix 5's Max Steering Angle. Taken to be lock to lock at the wheel, which
/// is unconfirmed: check in the game before using it.</param>
/// <param name="MaxRpm">Appendix 7.</param>
/// <param name="BrakeBiasOffset">Appendix 4: the dash's brake bias is brakeBias × 100 plus this.</param>
/// <param name="CarModelId">Appendix 6: the id ACC's broadcasting API uses.</param>
public sealed record AccCar(string KunosId, string Name, int MaxSteeringAngleDegrees, int MaxRpm, int BrakeBiasOffset, int CarModelId);

/// <summary>
/// The cars Kunos's document lists, up to the 2022 Challengers Pack. Later cars aren't in it: Find answers null for
/// them, and the caller falls back to the static page's own values (carModel as the name, maxRpm) and leaves what only
/// this table could give (the steering lock) unavailable.
/// </summary>
public static class AccCars
{
    public static IReadOnlyList<AccCar> All { get; } =
    [
        // GT3 - 2018
        new("amr_v12_vantage_gt3", "Aston Martin Vantage V12 GT3 2013", 320, 7750, -7, 12),
        new("audi_r8_lms", "Audi R8 LMS 2015", 360, 8650, -14, 3),
        new("bentley_continental_gt3_2016", "Bentley Continental GT3 2015", 320, 7500, -7, 11),
        new("bentley_continental_gt3_2018", "Bentley Continental GT3 2018", 320, 7400, -7, 8),
        new("bmw_m6_gt3", "BMW M6 GT3 2017", 283, 7100, -15, 7),
        new("jaguar_g3", "Emil Frey Jaguar G3 2012", 360, 8750, -7, 14),
        new("ferrari_488_gt3", "Ferrari 488 GT3 2018", 240, 7300, -17, 2),
        new("honda_nsx_gt3", "Honda NSX GT3 2017", 310, 7500, -14, 17),
        new("lamborghini_gallardo_rex", "Lamborghini Gallardo G3 Reiter 2017", 360, 8650, -14, 13),
        new("lamborghini_huracan_gt3", "Lamborghini Huracan GT3 2015", 310, 8650, -14, 4),
        new("lamborghini_huracan_st", "Lamborghini Huracan ST 2015", 310, 8650, -14, 18),
        new("lexus_rc_f_gt3", "Lexus RCF GT3 2016", 320, 7750, -14, 15),
        new("mclaren_650s_gt3", "McLaren 650S GT3 2015", 240, 7500, -17, 5),
        new("mercedes_amg_gt3", "Mercedes AMG GT3 2015", 320, 7900, -14, 1),
        new("nissan_gt_r_gt3_2017", "Nissan GTR Nismo GT3 2015", 320, 7500, -15, 10),
        new("nissan_gt_r_gt3_2018", "Nissan GTR Nismo GT3 2018", 320, 7500, -15, 6),
        new("porsche_991_gt3_r", "Porsche 991 GT3 R 2018", 400, 9250, -21, 0),
        new("porsche_991ii_gt3_cup", "Porsche 991 II GT3 Cup 2017", 400, 8500, -5, 9),
        // GT3 - 2019
        new("amr_v8_vantage_gt3", "Aston Martin V8 Vantage GT3 2019", 320, 7250, -7, 20),
        new("audi_r8_lms_evo", "Audi R8 LMS Evo 2019", 360, 8650, -14, 19),
        new("honda_nsx_gt3_evo", "Honda NSX GT3 Evo 2019", 310, 7650, -14, 21),
        new("lamborghini_huracan_gt3_evo", "Lamborghini Huracan GT3 EVO 2019", 310, 8650, -14, 16),
        new("mclaren_720s_gt3", "McLaren 720S GT3 2019", 240, 7700, -17, 22),
        new("porsche_991ii_gt3_r", "Porsche 911 II GT3 R 2019", 400, 9250, -21, 23),
        // GT4
        new("alpine_a110_gt4", "Alpine A110 GT4 2018", 360, 6450, -15, 50),
        new("amr_v8_vantage_gt4", "Aston Martin Vantage AMR GT4 2018", 320, 7000, -20, 51),
        new("audi_r8_gt4", "Audi R8 LMS GT4 2016", 360, 8650, -15, 52),
        new("bmw_m4_gt4", "BMW M4 GT4 2018", 246, 7600, -22, 53),
        new("chevrolet_camaro_gt4r", "Chevrolet Camaro GT4 R 2017", 360, 7500, -18, 55),
        new("ginetta_g55_gt4", "Ginetta G55 GT4 2012", 360, 7200, -18, 56),
        new("ktm_xbow_gt4", "KTM X-Bow GT4 2016", 290, 6500, -20, 57),
        new("maserati_mc_gt4", "Maserati GranTurismo MC GT4 2016", 450, 7000, -15, 58),
        new("mclaren_570s_gt4", "McLaren 570S GT4 2016", 240, 7600, -9, 59),
        new("mercedes_amg_gt4", "Mercedes AMG GT4 2016", 246, 7000, -20, 60),
        new("porsche_718_cayman_gt4_mr", "Porsche 718 Cayman GT4 MR 2019", 400, 7800, -20, 61),
        // GT3 - 2020
        new("ferrari_488_gt3_evo", "Ferrari 488 GT3 Evo 2020", 240, 7600, -17, 24),
        new("mercedes_amg_gt3_evo", "Mercedes AMG GT3 Evo 2020", 320, 7600, -14, 25),
        // GT3 - 2021
        new("bmw_m4_gt3", "BMW M4 GT3 2021", 270, 7000, -14, 30),
        // Challengers Pack - 2022
        new("audi_r8_lms_evo_ii", "Audi R8 LMS Evo II 2022", 360, 8650, -14, 31),
        new("bmw_m2_cs_racing", "BMW M2 Cup 2020", 180, 7520, -17, 27),
        new("ferrari_488_challenge_evo", "Ferrari 488 Challenge Evo 2020", 240, 8000, -13, 26),
        new("lamborghini_huracan_st_evo2", "Lamborghini Huracan ST Evo2 2021", 310, 8650, -14, 29),
        new("porsche_992_gt3_cup", "Porsche 992 GT3 Cup 2021", 270, 8750, -5, 28),
    ];

    private static readonly Dictionary<string, AccCar> ById = All.ToDictionary(c => c.KunosId, StringComparer.OrdinalIgnoreCase);

    /// <summary>The car with this carModel, or null for one the document doesn't list.</summary>
    public static AccCar? Find(string? kunosId) => kunosId is null ? null : ById.GetValueOrDefault(kunosId.Trim());
}
