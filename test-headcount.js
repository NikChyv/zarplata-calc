// Проверка расчёта численности. Логика берётся из buh_hub.html как есть,
// данные — из табеля 1С, который лежит рядом.
//
// Запуск: node test-headcount.js
//
// Файлов может быть два:
//   Табель.xls         — настоящая выгрузка (BIFF5, персональные данные, в репозиторий не коммитится)
//   Табель-пример.xls  — обезличенная копия (BIFF8, лежит в репозитории и гоняется на GitHub)
// Тест прогоняется по каждому найденному и требует одинаковых чисел: 1С пишет BIFF5,
// а если бухгалтер откроет и пересохранит файл в Excel — получится BIFF8.
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "buh_hub.html"), "utf8");
const endMark = html.indexOf("ЯДРО: конец.");
const core = html.slice(html.indexOf("const CP1251_HIGH ="), html.lastIndexOf("/*", endMark));
const M = new Function(core + `
  return { cp1251, readOleStream, readBiffCells, parseTabel, classifyDay,
           classifyEmployees, computeHeadcount, parseFooterNumbers };`)();

const CONFIG = JSON.parse(html.split('id="codes-config">')[1].split("</script>")[0]);

let fails = 0;
function eq(name, got, want) {
  const ok = String(got) === String(want);
  if (!ok) fails++;
  console.log((ok ? "  OK  " : " FAIL ") + name + " = " + got + (ok ? "" : "  (ожидалось " + want + ")"));
}
const f1 = (x) => x.toFixed(1);

/* ---------------- Проверки, не зависящие от файла ---------------- */
console.log("--- Распознавание кодов ---");
eq("число = часы явки", M.classifyDay("8", CONFIG).kind, "hours");
eq("часы с дробью", M.classifyDay("3.5", CONFIG).hours, 3.5);
eq("часы через запятую", M.classifyDay("3,5", CONFIG).hours, 3.5);
eq("пустая ячейка = не в списке", M.classifyDay("", CONFIG).kind, "none");
eq("В — в списочной", M.classifyDay("В", CONFIG).list, true);
eq("В — в СрСЧ", M.classifyDay("В", CONFIG).srsch, true);
eq("О — в списочной", M.classifyDay("О", CONFIG).list, true);
// Декретчики входят в списочную, но не в среднесписочную — правило заказчика от 05.08.2026.
// Инструкция в разделе 1 говорит обратное; следуем заказчику, не документу.
eq("ОЖ (декрет) — В списочной", M.classifyDay("ОЖ", CONFIG).list, true);
eq("ОЖ (декрет) — НЕ в СрСЧ", M.classifyDay("ОЖ", CONFIG).srsch, false);
eq("Б (больничный) — в списочной", M.classifyDay("Б", CONFIG).list, true);
eq("Б (больничный) — НЕ в СрСЧ", M.classifyDay("Б", CONFIG).srsch, false);
eq("А (за свой счёт) — в списочной", M.classifyDay("А", CONFIG).list, true);
eq("А (за свой счёт) — НЕ в СрСЧ", M.classifyDay("А", CONFIG).srsch, false);
eq("неизвестный код не угадывается", M.classifyDay("Щ", CONFIG).kind, "unknown");
eq("неизвестный код сохраняется для предупреждения", M.classifyDay("Щ", CONFIG).code, "Щ");

/* ---------------- Проверки на файлах ---------------- */
const files = ["Табель.xls", "Табель-пример.xls"]
  .map((f) => path.join(__dirname, f))
  .filter((f) => fs.existsSync(f));

if (!files.length) {
  console.log("\nНи одного табеля рядом не найдено — проверки расчёта пропущены.");
  process.exit(fails ? 1 : 0);
}

files.forEach((file) => {
  const name = path.basename(file);
  console.log("\n================ " + name + " ================");

  const sheet = M.readBiffCells(M.readOleStream(new Uint8Array(fs.readFileSync(file))));
  console.log("формат: " + (sheet.biff8 ? "BIFF8 (пересохранён в Excel)" : "BIFF5 (как отдаёт 1С)"));
  const tab = M.parseTabel(sheet);

  console.log("\n--- 1. Чтение шапки и метаданных ---");
  // Само нахождение шапки доказывает, что CP1251 раскодирована верно:
  // иначе слово «Фамилия» не нашлось бы и parseTabel бросил бы ошибку.
  eq("период", tab.period, "Июль 2026");
  eq("календарных дней", tab.calDays, 31);
  eq("рабочих дней", tab.workDays, 22);
  eq("сотрудников", tab.employees.length, 8);
  eq("должности читаются кириллицей", /^Швея \d разряда$/.test(tab.employees[1].post), true);
  eq("пометка совместителя на месте", /\(Совместитель\)/.test(tab.employees[6].post), true);
  eq("должность руководителя на месте", tab.employees[7].post, "Директор");

  const marked = M.classifyEmployees(tab, CONFIG);
  const e = (i) => marked.employees[i];

  console.log("\n--- 2. Категории сотрудников ---");
  eq("неизвестных кодов в табеле нет", Object.keys(marked.unknownCodes).length, 0);
  eq("полная месячная норма часов", marked.fullNorm, 175);
  eq("№1 — полное время", e(0).isPartTime, false);
  eq("№1 — 31 день в списке", e(0).daysInList, 31);
  eq("№2 уволена внутри месяца: 9 дней в списке", e(1).daysInList, 9);
  eq("№6 (весь месяц ОЖ) ВХОДИТ в списочную", e(5).daysInList, 31);
  eq("№6 исключена из СрСЧ", e(5).daysInSrsch, 0);
  eq("№7 — внешний совместитель", e(6).isSovmestitel, true);
  eq("№8 — неполное время", e(7).isPartTime, true);
  eq("№8 — ставка 0,5", e(7).rate, 0.5);
  eq("№8 — часы для пропорции", e(7).hoursSrsch, 87.5);
  eq("№7 — часы для пропорции", e(6).hoursSrsch, 12);

  console.log("\n--- 3. Показатели (разделы 2–6 и строки 56/57) ---");
  const dirIdx = marked.employees.findIndex((x) => /^директор$/i.test(x.post));
  const r = M.computeHeadcount(tab, marked, CONFIG, { byLaw: {}, gph: [], directorIdx: dirIdx });
  eq("Списочная в среднем за месяц (195 чел.-дней / 31)", f1(r.spisochnaya), "6.3");
  eq("Среднесписочная (4,290 целыми + 0,497 пропорц.)", f1(r.srsch), "4.8");
  eq("Средняя численность совместителей (12 ч / 8 / 22)", f1(r.sovmestiteli), "0.1");
  eq("Средняя численность по ГПД (данных нет)", f1(r.gph), "0.0");
  eq("Средняя в целом по организации", f1(r.total), "4.9");
  eq("Строка 56 — СрСЧ руководителя", f1(r.row56), "0.5");
  eq("Строка 57 — СрСЧ без руководителя", f1(r.row57), "4.3");
  eq("контроль: 56 + 57 = СрСЧ", f1(r.row56 + r.row57), f1(r.srsch));

  console.log("\n--- 4. Галочка «неполное время по закону» ---");
  const rLaw = M.computeHeadcount(tab, marked, CONFIG, { byLaw: { [dirIdx]: true }, gph: [], directorIdx: dirIdx });
  eq("руководитель считается целой единицей", f1(rLaw.row56), "1.0");
  eq("СрСЧ выросла, когда пропорция отключена", f1(rLaw.srsch), "5.3");
  eq("списочная от галочки не зависит", f1(rLaw.spisochnaya), f1(r.spisochnaya));

  console.log("\n--- 5. Договоры подряда ---");
  const rGph = M.computeHeadcount(tab, marked, CONFIG,
    { byLaw: {}, gph: [{ from: 1, to: 31 }, { from: 1, to: 15 }], directorIdx: dirIdx });
  eq("ГПД: 31 + 15 = 46 чел.-дней / 31", f1(rGph.gph), "1.5");
  eq("итог = СрСЧ + совместители + ГПД", f1(rGph.total), "6.4");
  eq("ГПД не влияют на СрСЧ", f1(rGph.srsch), f1(r.srsch));
  eq("ГПД не влияют на списочную", f1(rGph.spisochnaya), f1(r.spisochnaya));
  const rClamp = M.computeHeadcount(tab, marked, CONFIG,
    { byLaw: {}, gph: [{ from: 0, to: 99 }], directorIdx: dirIdx });
  eq("даты договора обрезаются по границам месяца", f1(rClamp.gph), "1.0");

  console.log("\n--- 6. Округление до одного знака (раздел 7) ---");
  const all = [r.spisochnaya, r.srsch, r.sovmestiteli, r.gph, r.total, r.row56, r.row57];
  const rounded = all.every((v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9);
  if (!rounded) fails++;
  console.log((rounded ? "  OK  " : " FAIL ") + "все семь показателей округлены до одного знака");

  console.log("\n--- 7. Расшифровка сходится с итогами ---");
  const sum = (k) => r.rows.reduce((s, x) => s + x[k], 0);
  eq("сумма вкладов в списочную = показатель", f1(sum("list")), f1(r.spisochnaya));
  eq("сумма вкладов в СрСЧ = показатель", f1(sum("srsch")), f1(r.srsch));
  eq("сумма вкладов в совместителей = показатель", f1(sum("sovm")), f1(r.sovmestiteli));
  eq("расшифровка есть по каждому сотруднику", r.rows.length, tab.employees.length);

  console.log("\n--- 8. Сверка с подвалом табеля ---");
  const foot = M.parseFooterNumbers(tab.footer);
  eq("прочитана списочная из подвала", foot.spisochnaya, 6.3);
  eq("прочитана среднесписочная из подвала", foot.srsch, 5);
  eq("прочитана средняя из подвала", foot.total, 6);
  eq("списочная теперь совпадает с 1С", f1(r.spisochnaya), f1(foot.spisochnaya));
  console.log("       со средней: " + f1(r.total - foot.total) +
              " — 1С считает совместителя и неполное время целыми единицами");
});

console.log(fails ? "\n=== ЕСТЬ ОШИБКИ: " + fails + " ===" : "\n=== ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ ===");
process.exit(fails ? 1 : 0);
