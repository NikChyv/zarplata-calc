// Проверка расчёта численности. Логика берётся из buh_hub.html как есть,
// данные — из табелей, которые лежат рядом.
//
// Запуск: node test-headcount.js
//
// Табелей два вида:
//   Табель*.xls          — настоящие выгрузки (персональные данные, в репозиторий не коммитятся)
//   Табель-пример*.xls   — обезличенные копии (лежат в репозитории и гоняются на GitHub)
// Каждый настоящий и каждый обезличенный проверяются одним и тем же набором ожиданий:
// 1С пишет BIFF5, а если бухгалтер откроет и пересохранит файл в Excel — получится BIFF8.
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "buh_hub.html"), "utf8");
const endMark = html.indexOf("ЯДРО: конец.");
const core = html.slice(html.indexOf("const CP1251_HIGH ="), html.lastIndexOf("/*", endMark));
const M = new Function(core + `
  return { cp1251, readOleStream, readBiffCells, parseTabel, classifyDay, snapRate, round1,
           classifyEmployees, computeHeadcount, parseFooterNumbers, readSpreadsheet, readXlsxCells, inflateRaw, readZip };`)();

const CONFIG = JSON.parse(html.split('id="codes-config">')[1].split("</script>")[0]);

let fails = 0;
function eq(name, got, want) {
  const ok = String(got) === String(want);
  if (!ok) fails++;
  console.log((ok ? "  OK  " : " FAIL ") + name + " = " + got + (ok ? "" : "  (ожидалось " + want + ")"));
}
const f1 = (x) => x.toFixed(1);

/* ================= Ожидания по каждому табелю =================
   Числа для «ЛилиДент» сверены с расчётом бухгалтера вручную (июль 2026): 4 / 2,5 / 4,8. */
const CASES = [
  {
    files: ["Табель.xls", "Табель-пример.xls"],
    title: "швейное производство: декретчица, внешний совместитель, директор на 0,5 ставки",
    // Средняя 5,4, а не 6,4: декретчица есть в списочной, но в среднюю не входит.
    // По этому табелю расчёта бухгалтера нет, число получено по правилам, проверенным
    // на трёх других клиентах.
    employees: 8, persons: 7, calDays: 31, workDays: 22, period: "Июль 2026",
    spisochnaya: "6.3", srsch: "4.8", sovm: "0.1", total: "5.4", row56: "0.5", row57: "4.3",
    checks: (e, eq) => {
      eq("№6 (весь месяц ОЖ) ВХОДИТ в списочную", e(5).daysInList, 31);
      eq("№6 не входит в среднесписочную", e(5).daysInSrsch, 0);
      eq("№7 — внешний совместитель", e(6).isSovmestitel, true);
      eq("№7 — ставка 0,1", e(6).rate, 0.1);
      eq("№8 — директор на половину ставки", e(7).rate, 0.5);
      eq("внутренних совместителей нет", e(7).isInner, false);
    }
  },
  {
    files: ["Табель Лилидент.xls", "Табель-пример-2.xls"],
    title: "стоматология: три внешних совместителя и один внутренний",
    // 8 строк табеля, но людей в списочной 4: трое внешних совместителей туда не входят,
    // а две должности Юдичевой — один человек.
    employees: 8, persons: 4, calDays: 31, workDays: 22, period: "Июль 2026",
    spisochnaya: "4.0", srsch: "2.5", sovm: "0.8", total: "4.8", row56: "1.0", row57: "1.5",
    checks: (e, eq) => {
      eq("№1 — внешний совместитель", e(0).isSovmestitel, true);
      eq("№1 — ставка подтянута к 0,25", e(0).rate, 0.25);
      eq("№3 — основной работник, не совместитель", e(2).isSovmestitel, false);
      eq("№6 — директор на целую ставку", e(5).rate, 1);
      eq("№7 — основная должность, 0,5 ставки", e(6).rate, 0.5);
      eq("№8 — ВНУТРЕННИЙ совместитель", e(7).isInner, true);
      eq("№8 не считается внешним совместителем", e(7).isSovmestitel, false);
      eq("№7 и №8 — один и тот же человек", e(6).fio === e(7).fio, true);
    }
  },
  {
    files: ["Табель Ноэлия.xls", "Табель-пример-3.xls"],
    title: "швейное производство, 21 человек: больничные, отпуска за свой счёт, три внешних совместителя",
    employees: 21, persons: 18, calDays: 31, workDays: 22, period: "Июль 2026",
    spisochnaya: "18.0", srsch: "14.4", sovm: "0.9", total: "18.9", row56: "1.0", row57: "13.4",
    checks: (e, eq) => {
      // Полная норма в этом табеле 176 ч, у большинства 175 — подтягивание к целой ставке
      eq("175 из 176 подтянуто к целой ставке", e(0).rate, 1);
      eq("сырая ставка до подтягивания", e(0).rateRaw.toFixed(3), "0.994");
      eq("бухгалтер на 0,1 ставки — внешний совместитель", e(3).isSovmestitel, true);
      eq("его ставка 0,1", e(3).rate, 0.1);
      // Больничный и отпуск за свой счёт: в списочной есть, в среднесписочной нет
      eq("22 дня больничного не идут в СрСЧ", e(4).daysInSrsch, 9);
      eq("но в списочной эти дни есть", e(4).daysInList, 31);
      eq("15 дней за свой счёт не идут в СрСЧ", e(13).daysInSrsch, 16);
      eq("и в списочной они есть", e(13).daysInList, 31);
    }
  },
  {
    files: ["Табель Мудрый зуб.xls", "Табель-пример-4.xls"],
    title: "стоматология: три длины рабочей недели в одном табеле, декретчица, больничные",
    employees: 15, persons: 12, calDays: 31, workDays: 22, period: "Июль 2026",
    spisochnaya: "12.0", srsch: "9.3", sovm: "0.5", total: "11.5", row56: "1.0", row57: "8.3",
    checks: (e, eq) => {
      // 168,4 ч — целая ставка медсестры (38,5-часовая неделя), а не 0,96 от нормы администратора.
      // 144,2 ч — целая ставка врача-стоматолога (33-часовая неделя).
      eq("168,4 ч — это целая ставка", e(0).rate, 1);
      eq("144,2 ч — это тоже целая ставка", e(3).rate, 1);
      eq("87,5 ч — половина от 175", e(5).rate, 0.5);
      eq("42,1 ч — четверть", e(2).rate, 0.25);
      // Декретчица: в списочной есть, в среднесписочной и в средней нет
      eq("декретчица в списочной", e(1).daysInList, 31);
      eq("декретчица не в СрСЧ", e(1).daysInSrsch, 0);
      eq("декретчица не в средней", e(1).daysInAvg, 0);
      // Больничный: не в СрСЧ, но в средней остаётся
      eq("больничный не идёт в СрСЧ", e(0).daysInSrsch, 29);
      eq("но в среднюю больничный идёт", e(0).daysInAvg, 31);
      eq("совместитель с 28 днями больничного", e(4).daysInSrsch, 3);
    }
  },
  {
    files: ["табель Ветмаинд.xlsx", "Табель-пример-5.xlsx"],
    title: "ветклиника, формат .xlsx и другая форма табеля: нет графы «Часовая норма», есть код П",
    employees: 5, persons: 5, calDays: 31, workDays: 22, period: "Июль 2026",
    spisochnaya: "5.0", srsch: "4.1", sovm: "0.0", total: "5.0", row56: "1.0", row57: "3.1",
    checks: (e, eq) => {
      eq("норма взята из группы «Время по норме»", e(0).normHours, 175);
      eq("все на целую ставку", e(0).rate, 1);
      eq("28 дней больничного не идут в СрСЧ", e(1).daysInSrsch, 3);
      eq("но в среднюю численность идут", e(1).daysInAvg, 31);
      eq("праздничный день считается как рабочий", e(2).daysInSrsch, 31);
    }
  },
  {
    files: ["Табель денс.xls", "Табель-пример-6.xls"],
    title: "танцевальная студия: несовершеннолетние на сокращённой неделе, 14 человек на 0,25 ставки",
    // Расчёт бухгалтера (июль 2026): спис. 18, сред. спис. 5,75 (рук. 1), сред. 18,25.
    // Наши 5,8 и 18,3 — те же числа после округления до одного знака.
    employees: 19, persons: 18, calDays: 31, workDays: 0, period: "Июль 2026",
    spisochnaya: "18.0", srsch: "5.8", sovm: "0.3", total: "18.3", row56: "1.0", row57: "4.8",
    // Сверка до округления: у бухгалтера ровно 5,75, и совпадение до третьего знака
    // ценнее округлённого 5,8 — округление могло бы скрыть ошибку в ставках.
    srschExact: "5.750",
    checks: (e, eq) => {
      eq("175 ч — целая ставка", e(9).rate, 1);
      eq("43,75 ч — четверть от 175", e(0).rate, 0.25);
      eq("87,5 ч — половина", e(3).rate, 0.5);
      // Несовершеннолетние: 35-часовая неделя, полная норма 153,1 ч, а не 175.
      // 38,25 / 175 = 0,219 подтянулось бы к 0,2 и занизило СрСЧ до 5,7.
      eq("38,25 ч несовершеннолетней — тоже четверть", e(17).rate, 0.25);
      eq("и у второй", e(18).rate, 0.25);
      eq("«(совместитель)» в должности распознан", e(13).isSovmestitel, true);
    }
  }
];

/* ---------------- Проверки, не зависящие от файла ---------------- */
console.log("--- Распознавание кодов ---");
eq("число = часы явки", M.classifyDay("8", CONFIG).kind, "hours");
eq("часы с дробью", M.classifyDay("3.5", CONFIG).hours, 3.5);
eq("часы через запятую", M.classifyDay("3,5", CONFIG).hours, 3.5);
eq("пустая ячейка = не в списке", M.classifyDay("", CONFIG).kind, "none");
eq("В — в списочной", M.classifyDay("В", CONFIG).list, true);
eq("О — в списочной", M.classifyDay("О", CONFIG).list, true);
// Декретчики входят в списочную, но не в среднесписочную — правило заказчика от 05.08.2026.
eq("ОЖ (декрет) — В списочной", M.classifyDay("ОЖ", CONFIG).list, true);
eq("ОЖ (декрет) — НЕ в СрСЧ", M.classifyDay("ОЖ", CONFIG).srsch, false);
eq("Б (больничный) — в списочной", M.classifyDay("Б", CONFIG).list, true);
eq("Б (больничный) — НЕ в СрСЧ", M.classifyDay("Б", CONFIG).srsch, false);
eq("А (за свой счёт) — в списочной", M.classifyDay("А", CONFIG).list, true);
eq("К (командировка) — в СрСЧ", M.classifyDay("К", CONFIG).srsch, true);
// «Д» — второй код декрета, ведёт себя как ОЖ (правила от 06.08.2026)
eq("Д (декрет) — в списочной", M.classifyDay("Д", CONFIG).list, true);
eq("Д (декрет) — НЕ в СрСЧ", M.classifyDay("Д", CONFIG).srsch, false);
eq("Д (декрет) — НЕ в средней", M.classifyDay("Д", CONFIG).avg, false);
// Уволенного 1С 8 рисует прочерками; в других версиях клетка просто пустая
eq("«--» (уволен) — не в списочной", M.classifyDay("--", CONFIG).list, false);
eq("одиночный прочерк — тоже уволен", M.classifyDay("-", CONFIG).list, false);
eq("длинное тире — тоже уволен", M.classifyDay("—", CONFIG).kind, "code");
eq("неизвестный код не угадывается", M.classifyDay("Щ", CONFIG).kind, "unknown");

console.log("\n--- Совместители: сокращение «совм.» и задвоенные фамилии ---");
const tabOf = (rows) => ({
  period: "Июль 2026", calDays: 31, workDays: 22, footer: "", dayCount: 31,
  employees: rows.map((r) => ({ fio: r[0], post: r[1], normHours: 175, workedHours: 0,
                                days: new Array(31).fill("В") }))
});
let m = M.classifyEmployees(tabOf([["Сотрудник 1", "администратор"],
                                   ["Сотрудник 2", "врач (совм.)"]]), CONFIG);
eq("«совм.» в должности — внешний совместитель", m.employees[1].isSovmestitel, true);
eq("обычная должность — не совместитель", m.employees[0].isSovmestitel, false);

// Правило от 06.08.2026: задвоенное ФИО — это внутреннее совместительство,
// даже когда в табеле нет никакой пометки.
m = M.classifyEmployees(tabOf([["Сотрудник 1", "директор"],
                               ["Сотрудник 1", "бухгалтер"]]), CONFIG);
eq("то же ФИО второй строкой — внутренний совместитель", m.employees[1].isInner, true);
eq("первая строка остаётся основной", m.employees[0].isInner, false);
eq("вторая строка — не внешний совместитель", m.employees[1].isSovmestitel, false);

m = M.classifyEmployees(tabOf([["Сотрудник 1", "врач (совм.)"],
                               ["Сотрудник 1 *", "врач-стоматолог"]]), CONFIG);
eq("задвоенное ФИО сильнее пометки о совместительстве", m.employees[0].isSovmestitel, false);
eq("звёздочка не мешает узнать того же человека", m.employees[1].isInner, true);

const twoPosts = tabOf([["Сотрудник 1", "директор"], ["Сотрудник 1", "бухгалтер"]]);
const hc = M.computeHeadcount(twoPosts, M.classifyEmployees(twoPosts, CONFIG), CONFIG, {});
eq("две должности одного человека — списочная 1,0", hc.spisochnaya, 1);
eq("...а в среднесписочной ставки складываются", hc.srsch, 2);

console.log("\n--- Подтягивание ставки к круглой доле ---");
eq("42,1 / 175 = 0,241 -> 0,25", M.snapRate(42.1 / 175), 0.25);
eq("84,2 / 175 = 0,481 -> 0,5", M.snapRate(84.2 / 175), 0.5);
eq("17,5 / 175 = 0,1 остаётся 0,1", M.snapRate(0.1), 0.1);
eq("целая ставка остаётся целой", M.snapRate(1), 1);
eq("далёкое значение не подтягивается", M.snapRate(0.44), 0.44);

console.log("\n--- Округление до одного знака, половина вверх ---");
// 0,1 + 0,25 + 0,5 хранится в double как 0,84999999999999998 — простой Math.round тут врёт
eq("0,1 + 0,25 + 0,5 = 0,85 -> 0,9", M.round1(0.1 + 0.25 + 0.5), 0.9);
eq("4,75 -> 4,8", M.round1(4.75), 4.8);
eq("14,35 -> 14,4", M.round1(14.35), 14.4);
eq("0,84999 честно меньше половины -> 0,8", M.round1(0.84999), 0.8);
eq("6,29 -> 6,3", M.round1(6.29), 6.3);

/* ---------------- Проверки на файлах ---------------- */
let ran = 0;
CASES.forEach((c) => {
  c.files.forEach((name) => {
    const file = path.join(__dirname, name);
    if (!fs.existsSync(file)) return;
    ran++;
    console.log("\n================ " + name + " ================");
    console.log(c.title);

    const sheet = M.readSpreadsheet(new Uint8Array(fs.readFileSync(file)));
    console.log("формат: " + (sheet.xlsx ? ".xlsx (zip + XML)" : sheet.biff8 ? "BIFF8 (пересохранён в Excel)" : "BIFF5 (как отдаёт 1С)"));
    const tab = M.parseTabel(sheet);

    console.log("\n--- 1. Чтение шапки ---");
    // Само нахождение шапки доказывает, что CP1251 раскодирована верно.
    eq("период", tab.period, c.period);
    eq("календарных дней", tab.calDays, c.calDays);
    eq("рабочих дней", tab.workDays, c.workDays);
    eq("строк в табеле", tab.employees.length, c.employees);

    const marked = M.classifyEmployees(tab, CONFIG);
    const e = (i) => marked.employees[i];
    console.log("\n--- 2. Категории ---");
    eq("неизвестных кодов нет", Object.keys(marked.unknownCodes).length, 0);
    c.checks(e, eq);

    console.log("\n--- 3. Показатели ---");
    const dirIdx = marked.employees.findIndex((x) => /директор/i.test(x.post) && !/заместител/i.test(x.post));
    const r = M.computeHeadcount(tab, marked, CONFIG, { byLaw: {}, gph: [], rates: {}, directorIdx: dirIdx });
    eq("людей (внутренний совместитель — один человек)", r.raw.persons, c.persons);
    eq("Списочная — людьми, целыми единицами", f1(r.spisochnaya), c.spisochnaya);
    eq("Среднесписочная — суммой ставок", f1(r.srsch), c.srsch);
    eq("Средняя численность внешних совместителей", f1(r.sovmestiteli), c.sovm);
    eq("Средняя в целом = списочная + совместители + ГПД", f1(r.total), c.total);
    eq("Строка 56 — СрСЧ руководителя", f1(r.row56), c.row56);
    eq("Строка 57 — СрСЧ без руководителя", f1(r.row57), c.row57);
    eq("контроль: 56 + 57 = СрСЧ", f1(r.row56 + r.row57), f1(r.srsch));
    if (c.srschExact) eq("среднесписочная до округления", r.raw.srschExact.toFixed(3), c.srschExact);

    console.log("\n--- 4. Ставку можно поправить руками ---");
    // ставим первому сотруднику заведомо другую ставку, чем распознана
    const other = e(0).rate === 1 ? 0.5 : 1;
    const rFix = M.computeHeadcount(tab, marked, CONFIG,
      { byLaw: {}, gph: [], rates: { 0: other }, directorIdx: dirIdx });
    const changed = f1(rFix.srsch) !== c.srsch || f1(rFix.sovmestiteli) !== c.sovm;
    if (!changed) fails++;
    console.log((changed ? "  OK  " : " FAIL ") + "правка ставки первого сотрудника меняет результат");
    eq("правка ставки не трогает списочную (она про людей)", f1(rFix.spisochnaya), c.spisochnaya);

    console.log("\n--- 5. Договоры подряда ---");
    const rGph = M.computeHeadcount(tab, marked, CONFIG,
      { byLaw: {}, gph: [{ from: 1, to: 31 }], rates: {}, directorIdx: dirIdx });
    eq("ГПД: 31 день ÷ 31", f1(rGph.gph), "1.0");
    eq("ГПД не влияют на СрСЧ", f1(rGph.srsch), c.srsch);
    eq("ГПД не влияют на списочную", f1(rGph.spisochnaya), c.spisochnaya);

    console.log("\n--- 6. Округление и расшифровка ---");
    const all = [r.spisochnaya, r.srsch, r.sovmestiteli, r.gph, r.total, r.row56, r.row57];
    const rounded = all.every((v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9);
    if (!rounded) fails++;
    console.log((rounded ? "  OK  " : " FAIL ") + "все семь показателей округлены до одного знака");
    const sum = (k) => M.round1(r.rows.reduce((s, x) => s + x[k], 0));
    eq("сумма вкладов в списочную = показатель", f1(sum("list")), c.spisochnaya);
    eq("сумма вкладов в СрСЧ = показатель", f1(sum("srsch")), c.srsch);
    eq("сумма вкладов в совместителей = показатель", f1(sum("sovm")), c.sovm);
    eq("расшифровка есть по каждой строке табеля", r.rows.length, c.employees);
  });
});

if (!ran) console.log("\nНи одного табеля рядом не найдено — проверки расчёта пропущены.");
console.log(fails ? "\n=== ЕСТЬ ОШИБКИ: " + fails + " ===" : "\n=== ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ ===");
process.exit(fails ? 1 : 0);
