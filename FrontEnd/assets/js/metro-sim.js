// MetriGo network + timetable simulation.
// Shared by the browser (window.MetroSim) and the server (require), so the
// departures a user books are the same trains they see moving on the live map.
// Times are Indian Standard Time regardless of the machine's timezone.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MetroSim = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Station order and names match BackEnd/data/stations.csv.
  // Coordinates are approximate positions of the real Delhi Metro stations.
  const LINES = {
    yellow: {
      id: "yellow", code: "YL", name: "Yellow Line", color: "#F2C200",
      stations: [
        ["Samaypur Badli", 28.7447, 77.1383], ["Rohini Sector 18-19", 28.7389, 77.1398],
        ["Haiderpur Badli Mor", 28.7300, 77.1494], ["Jahangirpuri", 28.7259, 77.1627],
        ["Adarsh Nagar", 28.7166, 77.1706], ["Azadpur", 28.7074, 77.1803],
        ["Model Town", 28.7029, 77.1940], ["GTB Nagar", 28.6977, 77.2069],
        ["Vishwavidyalaya", 28.6950, 77.2148], ["Vidhan Sabha", 28.6884, 77.2214],
        ["Civil Lines", 28.6770, 77.2249], ["Kashmere Gate", 28.6675, 77.2281],
        ["Chandni Chowk", 28.6580, 77.2301], ["Chawri Bazar", 28.6492, 77.2263],
        ["New Delhi", 28.6428, 77.2219], ["Rajiv Chowk", 28.6328, 77.2197],
        ["Patel Chowk", 28.6230, 77.2141], ["Central Secretariat", 28.6149, 77.2119],
        ["Udyog Bhawan", 28.6113, 77.2120], ["Lok Kalyan Marg", 28.5973, 77.2108],
        ["Jor Bagh", 28.5874, 77.2124], ["INA", 28.5752, 77.2093],
        ["AIIMS", 28.5684, 77.2079], ["Green Park", 28.5597, 77.2064],
        ["Hauz Khas", 28.5434, 77.2066], ["Malviya Nagar", 28.5282, 77.2057],
        ["Saket", 28.5203, 77.2014], ["Qutab Minar", 28.5131, 77.1863],
        ["Chhatarpur", 28.5067, 77.1749], ["Sultanpur", 28.4995, 77.1615],
        ["Ghitorni", 28.4939, 77.1490], ["Arjan Garh", 28.4807, 77.1257],
        ["Guru Dronacharya", 28.4820, 77.1023], ["Sikanderpur", 28.4810, 77.0928],
        ["MG Road", 28.4797, 77.0802], ["IFFCO Chowk", 28.4724, 77.0721],
        ["HUDA City Centre", 28.4593, 77.0727],
      ],
    },
    blue: {
      id: "blue", code: "BL", name: "Blue Line", color: "#2F7FE0",
      stations: [
        ["Dwarka Sec 21", 28.5523, 77.0583], ["Dwarka Sec 18-19", 28.5660, 77.0672],
        ["Dwarka Sec 10", 28.5810, 77.0574], ["Dwarka Sec 11-12", 28.5895, 77.0450],
        ["Dwarka", 28.6153, 77.0220], ["Dwarka Mor", 28.6193, 77.0331],
        ["Nawada", 28.6203, 77.0450], ["Uttam Nagar West", 28.6215, 77.0557],
        ["Uttam Nagar East", 28.6250, 77.0650], ["Janakpuri West", 28.6295, 77.0779],
        ["Janakpuri East", 28.6331, 77.0866], ["Tilak Nagar", 28.6366, 77.0965],
        ["Subhash Nagar", 28.6403, 77.1047], ["Tagore Garden", 28.6436, 77.1128],
        ["Rajouri Garden", 28.6490, 77.1227], ["Ramesh Nagar", 28.6528, 77.1316],
        ["Moti Nagar", 28.6576, 77.1425], ["Kirti Nagar", 28.6556, 77.1507],
        ["Shadipur", 28.6516, 77.1582], ["Patel Nagar", 28.6449, 77.1693],
        ["Rajendra Place", 28.6425, 77.1781], ["Karol Bagh", 28.6440, 77.1883],
        ["Jhandewalan", 28.6443, 77.2003], ["Ramakrishna Ashram Marg", 28.6393, 77.2085],
        ["Rajiv Chowk", 28.6328, 77.2197], ["Barakhamba Road", 28.6299, 77.2241],
        ["Mandi House", 28.6259, 77.2340], ["Pragati Maidan", 28.6236, 77.2425],
        ["Indraprastha", 28.6205, 77.2497], ["Yamuna Bank", 28.6236, 77.2681],
        ["Laxmi Nagar", 28.6305, 77.2775], ["Nirman Vihar", 28.6367, 77.2867],
        ["Preet Vihar", 28.6418, 77.2955], ["Karkarduma", 28.6485, 77.3058],
        ["Anand Vihar", 28.6502, 77.3152], ["Kaushambi", 28.6458, 77.3240],
        ["Vaishali", 28.6499, 77.3399],
      ],
    },
  };

  const SERVICE_START = 6 * 60;       // 06:00
  const SERVICE_END = 23 * 60;        // last departure from a terminal
  const AVG_SPEED_KMH = 34;
  const DWELL_MIN = 0.5;
  const TRANSFER_MIN = 4;
  const IST_OFFSET_MIN = 330;

  const TIME_SLOTS = {
    early_morning: { label: "Early morning", range: "6–8 AM", start: 360, end: 480, multiplier: 0.8 },
    morning_peak: { label: "Morning peak", range: "8–11 AM", start: 480, end: 660, multiplier: 1.3 },
    afternoon: { label: "Afternoon", range: "11 AM–5 PM", start: 660, end: 1020, multiplier: 0.9 },
    evening_peak: { label: "Evening peak", range: "5–9 PM", start: 1020, end: 1260, multiplier: 1.4 },
    night: { label: "Night", range: "9–11 PM", start: 1260, end: 1380, multiplier: 1 },
  };

  // Coarser windows for the Morning / Afternoon / Evening switch
  const DAY_PARTS = {
    morning: { label: "Morning", start: 360, end: 660 },
    afternoon: { label: "Afternoon", start: 660, end: 1020 },
    evening: { label: "Evening", start: 1020, end: 1380 },
  };

  function haversineKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // Per line: cumulative minutes from the first station (direction 0 = list order)
  Object.values(LINES).forEach(line => {
    line.coords = line.stations.map(s => [s[1], s[2]]);
    line.names = line.stations.map(s => s[0]);
    const offsets = [0];
    for (let i = 1; i < line.coords.length; i++) {
      const km = haversineKm(line.coords[i - 1], line.coords[i]) * 1.12; // track is not straight
      offsets.push(offsets[i - 1] + (km / AVG_SPEED_KMH) * 60 + DWELL_MIN);
    }
    line.offsets = offsets;
    line.runtime = offsets[offsets.length - 1];
    line.termini = [line.names[0], line.names[line.names.length - 1]];
  });

  const stationIndex = {};
  Object.values(LINES).forEach(line => {
    line.names.forEach((name, i) => {
      (stationIndex[name] = stationIndex[name] || []).push({ line: line.id, index: i, coord: line.coords[i] });
    });
  });

  function headway(min) {
    const peak = (min >= 480 && min < 660) || (min >= 1020 && min < 1260);
    return peak ? 3 : 5;
  }

  // Terminal departure minutes for one direction of a line (same every day)
  const terminalDepartures = [];
  for (let t = SERVICE_START; t <= SERVICE_END; t += headway(t)) terminalDepartures.push(t);

  // ---------- IST helpers ----------
  function istParts(ms) {
    const d = new Date(ms + IST_OFFSET_MIN * 60000);
    return {
      date: d.toISOString().slice(0, 10),
      minutes: d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60,
    };
  }
  function istDayStartMs(dateStr) {
    return Date.parse(dateStr + "T00:00:00Z") - IST_OFFSET_MIN * 60000;
  }
  function fmtTime(min) {
    const m = Math.round(min);
    const h = Math.floor(m / 60) % 24, mm = m % 60;
    const ap = h >= 12 ? "PM" : "AM";
    return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${ap}`;
  }

  // Minutes from the start of the trip to station index i, for a direction
  function offsetAt(line, dir, i) {
    return dir === 0 ? line.offsets[i] : line.runtime - line.offsets[i];
  }

  function trainId(line, dir, k) {
    return `${line.code}${dir === 0 ? "D" : "U"}-${String(101 + k)}`;
  }

  // ---------- Live positions ----------
  function livePositions(ms) {
    const { minutes } = istParts(ms);
    const out = [];
    Object.values(LINES).forEach(line => {
      [0, 1].forEach(dir => {
        terminalDepartures.forEach((dep, k) => {
          const elapsed = minutes - dep;
          if (elapsed < 0 || elapsed > line.runtime) return;
          const t = dir === 0 ? elapsed : line.runtime - elapsed; // position along list order
          let i = 0;
          while (i < line.offsets.length - 2 && line.offsets[i + 1] <= t) i++;
          const seg = line.offsets[i + 1] - line.offsets[i];
          const dwellFrac = DWELL_MIN / seg;
          let f = (t - line.offsets[i]) / seg;
          f = Math.max(0, Math.min(1, (f - dwellFrac) / (1 - dwellFrac)));
          const a = line.coords[i], b = line.coords[i + 1];
          const nextIdx = dir === 0 ? i + 1 : i;
          out.push({
            id: trainId(line, dir, k),
            line: line.id,
            dir,
            towards: line.termini[dir === 0 ? 1 : 0],
            lat: a[0] + (b[0] - a[0]) * f,
            lng: a[1] + (b[1] - a[1]) * f,
            nextStation: line.names[nextIdx],
            nextInMin: Math.max(0, dep + offsetAt(line, dir, nextIdx) - minutes),
            progress: elapsed / line.runtime,
          });
        });
      });
    });
    return out;
  }

  // ---------- Arrivals board for a station ----------
  function nextArrivals(station, ms, perDirection) {
    const { minutes } = istParts(ms);
    const n = perDirection || 3;
    const out = [];
    (stationIndex[station] || []).forEach(({ line: lid, index }) => {
      const line = LINES[lid];
      [0, 1].forEach(dir => {
        const lastIdx = dir === 0 ? line.names.length - 1 : 0;
        if (index === lastIdx) return; // terminating here
        let found = 0;
        for (let k = 0; k < terminalDepartures.length && found < n; k++) {
          const at = terminalDepartures[k] + offsetAt(line, dir, index);
          if (at < minutes - 0.2) continue;
          out.push({
            trainId: trainId(line, dir, k), line: lid, towards: line.termini[dir === 0 ? 1 : 0],
            at, inMin: Math.max(0, at - minutes), time: fmtTime(at),
          });
          found++;
        }
      });
    });
    return out.sort((a, b) => a.at - b.at);
  }

  // ---------- Journey planning along a station path ----------
  function lineBetween(a, b) {
    for (const line of Object.values(LINES)) {
      const i = line.names.indexOf(a), j = line.names.indexOf(b);
      if (i !== -1 && j !== -1 && Math.abs(i - j) === 1) return { line, dir: j > i ? 0 : 1 };
    }
    return null;
  }

  function legsForPath(path) {
    const legs = [];
    for (let i = 0; i < path.length - 1; i++) {
      const hop = lineBetween(path[i], path[i + 1]);
      if (!hop) return null;
      const last = legs[legs.length - 1];
      if (last && last.line === hop.line.id && last.dir === hop.dir) {
        last.to = path[i + 1];
        last.stops++;
      } else {
        legs.push({ line: hop.line.id, dir: hop.dir, from: path[i], to: path[i + 1], stops: 1 });
      }
    }
    return legs;
  }

  // Board the first train on each leg at or after `afterMin`
  function scheduleLegs(legs, afterMin) {
    let t = afterMin;
    const out = [];
    for (const leg of legs) {
      const line = LINES[leg.line];
      const fi = line.names.indexOf(leg.from), ti = line.names.indexOf(leg.to);
      const k = terminalDepartures.findIndex(d => d + offsetAt(line, leg.dir, fi) >= t - 1e-9);
      if (k === -1) return null;
      const board = terminalDepartures[k] + offsetAt(line, leg.dir, fi);
      const alight = terminalDepartures[k] + offsetAt(line, leg.dir, ti);
      out.push({
        ...leg, trainId: trainId(line, leg.dir, k), towards: line.termini[leg.dir === 0 ? 1 : 0],
        board, alight, boardTime: fmtTime(board), alightTime: fmtTime(alight),
      });
      t = alight + TRANSFER_MIN;
    }
    return out;
  }

  // Departures from the origin within [startMin, endMin)
  function departures(path, startMin, endMin, limit) {
    const legs = legsForPath(path);
    if (!legs || !legs.length) return [];
    const first = LINES[legs[0].line];
    const fi = first.names.indexOf(legs[0].from);
    const out = [];
    for (let k = 0; k < terminalDepartures.length && out.length < (limit || 12); k++) {
      const board = terminalDepartures[k] + offsetAt(first, legs[0].dir, fi);
      if (board < startMin || board >= endMin) continue;
      const sched = scheduleLegs(legs, board);
      if (!sched) break;
      const arrive = sched[sched.length - 1].alight;
      out.push({
        trainId: sched[0].trainId, line: sched[0].line, towards: sched[0].towards,
        depart: board, arrive, departTime: fmtTime(board), arriveTime: fmtTime(arrive),
        durationMin: Math.round(arrive - board), legs: sched,
      });
    }
    return out;
  }

  function stationNames() {
    return Object.keys(stationIndex).sort((a, b) => a.localeCompare(b));
  }

  return {
    LINES, TIME_SLOTS, DAY_PARTS, stationIndex, terminalDepartures,
    istParts, istDayStartMs, fmtTime,
    livePositions, nextArrivals, legsForPath, scheduleLegs, departures, stationNames,
  };
});
