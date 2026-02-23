const routes = [
    /\b(?:monitoruj|obserwuj|[śs]led[źz])\b/i,
    /monitor.*flag/i,
    /vision.*pipeline|pipeline.*vision|ai.*monitor|monitoring.*ai|detekcja.*ai|yolo.*monitor|start.*vision|uruchom.*vision|w[łl]ącz.*vision|status.*vision|stop.*vision|zatrzymaj.*vision/i,
    /\b(?:zachowaj|wybierz)\s+monitoring\s+cd_[a-z0-9_]+\b/i,
    /\b(?:w[łl]ącz|wlacz|wy[łl]ącz|wylacz)\s+monitor/i,
    /(?:stop|zatrzymaj|przesta[ńn]).*monitor/i,
    /(?:aktywne|lista|list).*(?:monitor|watch)/i,
    /logi|historia.*zmian|poka[żz].*log/i,
    /(?:ustaw|zmie[ńn]).*(?:pr[oó]g|interwa[łl])/i,
    /(?:jak.*dzia[łl]a|wyja[śs]ni[jć]).*monitor|tryb.*(?:detekcji|wykrywan)|monitor.*(?:explain|help)/i
];
const text = "ile osób było w pomieszczeniu w ostatnich 100 minutach";
routes.forEach((r, i) => {
    if (r.test(text)) console.log(`Matched ${i}: ${r}`);
});
console.log("Done.");
