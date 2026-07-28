// Проверка ядра расчёта: код берётся из index.html как есть (без копипасты).
const fs = require("fs");
const html = fs.readFileSync("c:/Calculator ZP/index.html", "utf8");

const cfg = html.split('id="rates-config">')[1].split("</script>")[0];
const core = html.slice(html.indexOf("const rub ="), html.indexOf("/* ----------------------------- Утилиты"));
const R = JSON.parse(cfg);
const mod = new Function("R", core + "\nreturn {calc, grossFromNet, D};")(R);
const { calc, grossFromNet, D } = mod;

const P = (o = {}) => Object.assign(
  { contractor: false, children: 0, childrenEnh: 0, special: false, socialK: 0,
    unionRate: 0, dpnsRate: 0, belgosRate: 0.006 }, o);
const f = (k) => (k / 100).toFixed(2);

let fails = 0;
function eq(name, got, want) {
  const ok = got === want;
  if (!ok) fails++;
  console.log((ok ? "  OK  " : " FAIL ") + name + " = " + got + (ok ? "" : "  (ожидалось " + want + ")"));
}

console.log("--- 1. Прямой расчёт, зарплата выше порога, без опций (Gross 2000) ---");
let r = calc(200000, P());
eq("ФСЗН 1%", f(r.fsznK), "20.00");
eq("облагаемый доход", f(r.subjectK), "1980.00");
eq("личный вычет не применяется", r.personalK, 0);
eq("налог 13% от 1980", f(r.taxK), "257.40");
eq("на руки", f(r.netK), "1722.60");

console.log("\n--- 2. Прямой расчёт, все опции (Gross 2000, 1 ребёнок, профсоюз 1%, ДПНС 3%, соц. вычет 100) ---");
r = calc(200000, P({ children: 1, unionRate: 0.01, dpnsRate: 0.03, socialK: 10000 }));
eq("ДПНС 3%", f(r.dpnsK), "60.00");
eq("облагаемый доход 2000-20-60", f(r.subjectK), "1920.00");
eq("вычет на ребёнка", f(r.childrenK), "63.00");
eq("база 1920-63-100", f(r.baseK), "1757.00");
eq("налог", f(r.taxK), "228.41");
eq("профсоюз 1%", f(r.unionK), "20.00");
eq("на руки 2000-20-60-228.41-20", f(r.netK), "1671.59");

console.log("\n--- 3. Порог личного вычета (216 р. при облагаемом доходе <= 1308) ---");
// Gross 1321.21 -> ФСЗН 13.21 -> облагаемый 1308.00 ровно
r = calc(132121, P());
eq("облагаемый доход ровно на пороге", f(r.subjectK), "1308.00");
eq("вычет применён", f(r.personalK), "216.00");
r = calc(132122, P());
eq("облагаемый доход на копейку выше", f(r.subjectK), "1308.01");
eq("вычет отменён", r.personalK, 0);

console.log("\n--- 4. Разрыв функции на пороге: на руки падает на 28.08 ---");
const netLo = calc(132121, P()).netK, netHi = calc(132122, P()).netK;
eq("падение на руки при +1 коп. начисления", f(netLo - netHi), "28.07");
console.log("       (на руки: " + f(netLo) + " -> " + f(netHi) + " — функция немонотонна)");

console.log("\n--- 5. Обратный расчёт: точное совпадение и корректность ветки ---");
[100000, 120000, 150000, 200000, 350000].forEach((netTarget) => {
  const p = P({ children: 2, unionRate: 0.01, dpnsRate: 0.03 });
  const g = grossFromNet(netTarget, p);
  const back = calc(g.grossK, p);
  const ok = back.netK >= netTarget && calc(g.grossK - 1, p).netK < netTarget;
  if (!ok) fails++;
  console.log((ok ? "  OK  " : " FAIL ") + "цель " + f(netTarget) + " -> начислить " + f(g.grossK) +
    " -> на руки " + f(back.netK) + " (расхождение " + f(back.netK - netTarget) + ")");
});

console.log("\n--- 6. Зона разрыва: обратный расчёт должен брать МЕНЬШИЙ Gross, а не больший ---");
{
  const p = P();
  const target = calc(132121, p).netK;              // достижимо на нижней ветке
  const g = grossFromNet(target, p);
  eq("выбран Gross нижней ветки", f(g.grossK), f(132121));
  // Наивный бинарный поиск по всему диапазону для сравнения:
  let lo = 0, hi = 400000;
  while (lo < hi) { const m = Math.floor((lo + hi) / 2); if (calc(m, p).netK >= target) hi = m; else lo = m + 1; }
  console.log("       наивный бинарный поиск дал бы: " + f(lo) + " (переплата " + f(lo - g.grossK) + " р.)");
}

console.log("\n--- 7. Сплошная проверка: обратный расчёт == минимальный Gross (перебор 0..3000 р.) ---");
{
  const p = P({ children: 1, unionRate: 0.01, dpnsRate: 0.05, socialK: 5000 });
  const LIM = 400000;                                   // перебор Gross 0..4000 р. с шагом 1 копейка
  const nets = [];
  for (let g = 0; g <= LIM; g++) nets.push(calc(g, p).netK);
  let bad = 0, checked = 0;
  for (let t = 1000; t <= 250000; t += 137) {           // шаг 1.37 р., ~1800 целей
    let want = -1;
    for (let g = 0; g <= LIM; g++) if (nets[g] >= t) { want = g; break; }
    const got = grossFromNet(t, p).grossK;
    checked++;
    if (got !== want) { bad++; if (bad < 4) console.log("  FAIL цель " + f(t) + ": получено " + f(got) + ", перебор дал " + f(want)); }
  }
  if (bad) fails++;
  console.log((bad ? " FAIL " : "  OK  ") + "проверено целей: " + checked + ", расхождений: " + bad);
}

console.log("\n--- 8. Стоимость для нанимателя (Gross 2000, Белгосстрах 0.6%, ДПНС 5%) ---");
r = calc(200000, P({ dpnsRate: 0.05 }));
eq("ФСЗН пенсионное 28%", f(r.pensionK), "560.00");
eq("ФСЗН социальное 6%", f(r.socInsK), "120.00");
eq("Белгосстрах 0.6%", f(r.belgosK), "12.00");
eq("доплата по ДПНС (макс. 3%, справочно)", f(r.matchK), "60.00");
eq("итого расходы = 2000+560+120+12", f(r.totalCostK), "2692.00");

console.log("\n--- 9. Договор подряда (ГПХ): вычеты не предоставляются ---");
{
  // Доход ниже порога 1308 — по трудовому договору личный вычет применился бы.
  const opts = { children: 2, childrenEnh: 1, special: true, socialK: 10000 };
  const emp = calc(120000, P(opts));                 // трудовой договор
  const gph = calc(120000, P({ ...opts, contractor: true }));
  // 216 личный + 2×63 дети + 120 повышенный + 306 льготная категория + 100 социальный
  eq("по трудовому договору вычеты есть", f(emp.stdK + emp.socialK), "868.00");
  eq("по подряду стандартные вычеты обнулены", gph.stdK, 0);
  eq("по подряду социальные вычеты обнулены", gph.socialK, 0);
  eq("по подряду база = доход после ФСЗН", f(gph.baseK), f(gph.subjectK));
  eq("налог по подряду 13% от 1188", f(gph.taxK), "154.44");
  eq("на руки по подряду 1200-12-154.44", f(gph.netK), "1033.56");
  const ok = gph.netK < emp.netK;
  if (!ok) fails++;
  console.log((ok ? "  OK  " : " FAIL ") + "на руки по подряду меньше: " + f(gph.netK) + " против " + f(emp.netK));
}

console.log("\n--- 10. Обратный расчёт для подряда ---");
{
  const p = P({ contractor: true, children: 3 });
  [100000, 130000, 200000].forEach((t) => {
    const g = grossFromNet(t, p);
    const ok = g.netK >= t && calc(g.grossK - 1, p).netK < t && g.stdK === 0;
    if (!ok) fails++;
    console.log((ok ? "  OK  " : " FAIL ") + "цель " + f(t) + " -> начислить " + f(g.grossK) +
      " -> на руки " + f(g.netK) + ", вычеты " + f(g.stdK));
  });
}

console.log("\n--- 11. Граничные случаи ---");
eq("нулевое начисление -> на руки 0", calc(0, P()).netK, 0);
eq("база не уходит в минус при большом соц. вычете", calc(100000, P({ socialK: 500000 })).baseK, 0);
eq("налог при нулевой базе", calc(100000, P({ socialK: 500000 })).taxK, 0);

console.log(fails ? "\n=== ЕСТЬ ОШИБКИ: " + fails + " ===" : "\n=== ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ ===");
process.exit(fails ? 1 : 0);
