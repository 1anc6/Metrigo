// MetriGo network + timetable simulation.
// Shared by the browser (window.MetroSim) and the server (require), so the
// departures a user books are the same trains they see moving on the live map.
// Times are Indian Standard Time regardless of the machine's timezone.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MetroSim = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Station order, names and positions come from OpenStreetMap route relations
  // (© OpenStreetMap contributors, ODbL) and match Backend/data/stations.csv.
  // Branches are their own entries (e.g. bluebranch: Yamuna Bank–Vaishali) and
  // share a `group` with their main line for colours and filters.
  // Rapid Metro Gurugram and Noida's Aqua Line are separate networks, not included.
  const LINES = {
    red: {
      id: "red", code: "RD", name: "Red Line", group: "red", color: "#E2312F",
      stations: [
        ["Rithala", 28.7208, 77.1072], ["Rohini West", 28.715, 77.1154],
        ["Rohini East", 28.7076, 77.126], ["Madhuban Chowk", 28.7033, 77.1322],
        ["Kohat Enclave", 28.698, 77.1405], ["Netaji Subhash Place", 28.6961, 77.1525],
        ["Keshav Puram", 28.6889, 77.1617], ["Kanhaiya Nagar", 28.6824, 77.1648],
        ["Inderlok", 28.6736, 77.1703], ["Shastri Nagar", 28.6701, 77.1819],
        ["Pratap Nagar", 28.6667, 77.1989], ["Pul Bangash", 28.6664, 77.2074],
        ["Tis Hazari", 28.6672, 77.2166], ["Kashmere Gate", 28.6675, 77.2282],
        ["Shastri Park", 28.6685, 77.2505], ["Seelampur", 28.6699, 77.2668],
        ["Welcome", 28.6719, 77.2778], ["Shahdara", 28.6735, 77.2899],
        ["Mansarovar Park", 28.6754, 77.3009], ["Jhilmil", 28.6758, 77.3124],
        ["Dilshad Garden", 28.6759, 77.3215], ["Shaheed Nagar", 28.6767, 77.3339],
        ["Raj Bagh", 28.6771, 77.3469], ["Rajendra Nagar", 28.6776, 77.3581],
        ["Shyam Park", 28.6782, 77.3705], ["Mohan Nagar", 28.6786, 77.3839],
        ["Arthala", 28.677, 77.3919], ["Hindon River", 28.6735, 77.4065],
        ["Shaheed Sthal", 28.6707, 77.4154],
      ],
    },
    yellow: {
      id: "yellow", code: "YL", name: "Yellow Line", group: "yellow", color: "#F2C200",
      stations: [
        ["Samaypur Badli", 28.7446, 77.1383], ["Rohini Sector 18-19", 28.7383, 77.1399],
        ["Haiderpur Badli Mor", 28.7299, 77.1489], ["Jahangirpuri", 28.726, 77.1627],
        ["Adarsh Nagar", 28.7166, 77.1704], ["Azadpur", 28.7071, 77.1804],
        ["Model Town", 28.7027, 77.194], ["GTB Nagar", 28.6982, 77.2064],
        ["Vishwa Vidyalaya", 28.6951, 77.2147], ["Vidhan Sabha", 28.6863, 77.2218],
        ["Civil Lines", 28.6769, 77.2251], ["Kashmere Gate", 28.6675, 77.2282],
        ["Chandni Chowk", 28.6584, 77.2304], ["Chawri Bazaar", 28.6493, 77.2265],
        ["New Delhi", 28.6435, 77.2228], ["Rajiv Chowk", 28.6327, 77.2194],
        ["Patel Chowk", 28.623, 77.2141], ["Central Secretariat", 28.6159, 77.2123],
        ["Seva Teerth", 28.6095, 77.2118], ["Lok Kalyan Marg", 28.5974, 77.2111],
        ["Jor Bagh", 28.5866, 77.2126], ["Dilli Haat - INA", 28.5742, 77.2093],
        ["AIIMS", 28.5669, 77.2078], ["Green Park", 28.558, 77.2068],
        ["Hauz Khas", 28.5443, 77.2067], ["Malviya Nagar", 28.5291, 77.2049],
        ["Saket", 28.5209, 77.2019], ["Qutab Minar", 28.5129, 77.1865],
        ["Chhatarpur", 28.5068, 77.1749], ["Sultanpur", 28.499, 77.1609],
        ["Ghitorni", 28.4937, 77.1492], ["Arjan Garh", 28.4807, 77.1258],
        ["Guru Dronacharya", 28.482, 77.1023], ["Sikanderpur", 28.4812, 77.093],
        ["MG Road", 28.4795, 77.0799], ["IFFCO Chowk", 28.4723, 77.0725],
        ["Millennium City Centre Gurugram", 28.4593, 77.0727],
      ],
    },
    blue: {
      id: "blue", code: "BL", name: "Blue Line", group: "blue", color: "#2F7FE0",
      stations: [
        ["Dwarka Sector 21", 28.552, 77.0584], ["Dwarka Sector 8", 28.5656, 77.067],
        ["Dwarka Sector 9", 28.5743, 77.0653], ["Dwarka Sector 10", 28.581, 77.0575],
        ["Dwarka Sector 11", 28.5864, 77.0494], ["Dwarka Sector 12", 28.5922, 77.0407],
        ["Dwarka Sector 13", 28.597, 77.0335], ["Dwarka Sector 14", 28.6022, 77.026],
        ["Dwarka", 28.6149, 77.0227], ["Dwarka Mor", 28.6193, 77.0333],
        ["Nawada", 28.6203, 77.0451], ["Uttam Nagar West", 28.6218, 77.0557],
        ["Uttam Nagar East", 28.6249, 77.0653], ["Janakpuri West", 28.6296, 77.0781],
        ["Janakpuri East", 28.633, 77.0867], ["Tilak Nagar", 28.6366, 77.0965],
        ["Subhash Nagar", 28.6405, 77.1052], ["Tagore Garden", 28.6438, 77.1128],
        ["Rajouri Garden", 28.6491, 77.1227], ["Ramesh Nagar", 28.6528, 77.1316],
        ["Moti Nagar", 28.6579, 77.1424], ["Kirti Nagar", 28.6558, 77.1507],
        ["Shadipur", 28.6516, 77.1583], ["Patel Nagar", 28.645, 77.1693],
        ["Rajendra Place", 28.6425, 77.1783], ["Karol Bagh", 28.644, 77.1885],
        ["Jhandewalan", 28.6443, 77.1999], ["Ramakrishna Ashram Marg", 28.6393, 77.2086],
        ["Rajiv Chowk", 28.6328, 77.2197], ["Barakhambha Road", 28.6298, 77.225],
        ["Mandi House", 28.6256, 77.2342], ["Supreme Court", 28.6235, 77.2425],
        ["Indraprastha", 28.6206, 77.2496], ["Yamuna Bank", 28.6233, 77.268],
        ["Akshardham", 28.6179, 77.2796], ["Mayur Vihar - I", 28.6041, 77.2896],
        ["Mayur Vihar Extension", 28.5945, 77.2945], ["New Ashok Nagar", 28.5892, 77.3016],
        ["Noida Sector 15", 28.585, 77.3117], ["Noida Sector 16", 28.5781, 77.3179],
        ["Noida Sector 18", 28.5708, 77.3262], ["Botanical Garden", 28.564, 77.3344],
        ["Noida Golf Course", 28.5675, 77.3464], ["Noida City Centre", 28.5748, 77.3562],
        ["Noida Sector 34", 28.5803, 77.3635], ["Noida Sector 52", 28.5868, 77.3728],
        ["Noida Sector 61", 28.5976, 77.3722], ["Noida Sector 59", 28.6065, 77.3726],
        ["Noida Sector 62", 28.617, 77.3736], ["Noida Electronic City", 28.6283, 77.375],
      ],
    },
    bluebranch: {
      id: "bluebranch", code: "BB", name: "Blue Line", group: "blue", branch: "Vaishali branch", color: "#2F7FE0",
      stations: [
        ["Yamuna Bank", 28.6233, 77.268], ["Laxmi Nagar", 28.6306, 77.2775],
        ["Nirman Vihar", 28.6366, 77.2868], ["Preet Vihar", 28.6414, 77.2953],
        ["Karkarduma", 28.6484, 77.3055], ["Anand Vihar", 28.6469, 77.3161],
        ["Kaushambi", 28.6454, 77.3243], ["Vaishali", 28.6498, 77.3395],
      ],
    },
    green: {
      id: "green", code: "GN", name: "Green Line", group: "green", color: "#1F9D45",
      stations: [
        ["Inderlok", 28.6726, 77.1691], ["Ashok Park Main", 28.6715, 77.1553],
        ["Punjabi Bagh", 28.6729, 77.1461], ["Punjabi Bagh West", 28.674, 77.1406],
        ["Shivaji Park", 28.675, 77.1305], ["Madipur", 28.6764, 77.1193],
        ["Paschim Vihar East", 28.6773, 77.1123], ["Paschim Vihar West", 28.6786, 77.1022],
        ["Peeragarhi", 28.6797, 77.0927], ["Udyog Nagar", 28.681, 77.0808],
        ["Surajmal Stadium", 28.6818, 77.074], ["Nangloi", 28.6823, 77.0647],
        ["Nangloi Railway Station", 28.6821, 77.0562], ["Rajdhani Park", 28.6822, 77.0439],
        ["Mundka", 28.6824, 77.0306], ["Mundka Industrial Area", 28.6834, 77.0171],
        ["Ghevra", 28.6852, 76.9961], ["Tikri Kalan", 28.6868, 76.9772],
        ["Tikri Border", 28.6879, 76.9641], ["Pandit Shree Ram Sharma", 28.6892, 76.9512],
        ["Bahadurgarh City", 28.6907, 76.9354], ["Brigadier Hoshiyar Singh", 28.6973, 76.9191],
      ],
    },
    greenbranch: {
      id: "greenbranch", code: "GB", name: "Green Line", group: "green", branch: "Kirti Nagar branch", color: "#1F9D45",
      stations: [
        ["Kirti Nagar", 28.6546, 77.1513], ["Satguru Ramsingh Marg", 28.6621, 77.1576],
        ["Ashok Park Main", 28.6715, 77.1553],
      ],
    },
    violet: {
      id: "violet", code: "VL", name: "Violet Line", group: "violet", color: "#7A3FB8",
      stations: [
        ["Kashmere Gate", 28.6687, 77.2281], ["Lal Quila", 28.6575, 77.2367],
        ["Jama Masjid", 28.65, 77.2377], ["Delhi Gate", 28.6392, 77.2408],
        ["ITO", 28.6282, 77.2411], ["Mandi House", 28.6255, 77.2342],
        ["Janpath", 28.624, 77.2193], ["Central Secretariat", 28.6159, 77.2124],
        ["Khan Market", 28.6023, 77.2291], ["Jawaharlal Nehru Stadium", 28.5882, 77.2338],
        ["Jangpura", 28.583, 77.2393], ["Lajpat Nagar", 28.5706, 77.2364],
        ["Moolchand", 28.5644, 77.2343], ["Kailash Colony", 28.5553, 77.242],
        ["Nehru Place", 28.5514, 77.2517], ["Kalkaji Mandir", 28.5495, 77.2591],
        ["Govind Puri", 28.5444, 77.2643], ["Harkesh Nagar Okhla", 28.5433, 77.2757],
        ["Jasola Apollo", 28.5384, 77.283], ["Sarita Vihar", 28.5286, 77.2883],
        ["Mohan Estate", 28.5197, 77.2945], ["Tughlakabad", 28.5024, 77.2992],
        ["Badarpur", 28.4932, 77.303], ["Sarai", 28.478, 77.3049],
        ["NHPC Chowk", 28.4578, 77.3074], ["Mewala Maharajpur", 28.4486, 77.3081],
        ["Sector 28", 28.4382, 77.3091], ["Badhkal Mor", 28.4227, 77.3104],
        ["Old Faridabad", 28.4108, 77.3115], ["Neelam Chowk Ajronda", 28.3975, 77.3124],
        ["Bata Chowk", 28.3858, 77.3135], ["Escorts Mujesar", 28.3702, 77.3149],
        ["Sant Surdas (Sihi)", 28.3547, 77.3162], ["Raja Nahar Singh", 28.34, 77.3165],
      ],
    },
    pink: {
      id: "pink", code: "PK", name: "Pink Line", group: "pink", color: "#EE6F9C",
      stations: [
        ["Majlis Park", 28.7241, 77.1821], ["Azadpur", 28.7058, 77.182],
        ["Shalimar Bagh", 28.7019, 77.1655], ["Netaji Subhash Place", 28.6947, 77.1543],
        ["Shakurpur", 28.6857, 77.1497], ["Punjabi Bagh West", 28.6728, 77.1392],
        ["ESI - Basaidarapur", 28.658, 77.1273], ["Rajouri Garden", 28.6512, 77.1243],
        ["Mayapuri", 28.6372, 77.1298], ["Naraina Vihar", 28.6244, 77.1365],
        ["Delhi Cantt", 28.6086, 77.1404], ["Durgabai Deshmukh South Campus", 28.5893, 77.1695],
        ["Sir M. Vishweshwaraiah Moti Bagh", 28.5785, 77.1758], ["Bhikaji Cama Place", 28.5703, 77.1879],
        ["Sarojini Nagar", 28.5758, 77.1981], ["Dilli Haat - INA", 28.5737, 77.2076],
        ["South Extension", 28.5686, 77.2206], ["Lajpat Nagar", 28.5695, 77.2389],
        ["Vinobapuri", 28.5659, 77.2498], ["Ashram", 28.5726, 77.2588],
        ["Sarai Kale Khan - Nizamuddin", 28.5898, 77.257], ["Mayur Vihar - I", 28.6038, 77.2913],
        ["Shree Ram Mandir Mayur Vihar", 28.6061, 77.2993], ["Trilokpuri Sanjay Lake", 28.6134, 77.3088],
        ["East Vinod Nagar - Mayur Vihar - II", 28.6201, 77.3054], ["Mandawali - West Vinod Nagar", 28.625, 77.3045],
        ["IP Extension", 28.6319, 77.3107], ["Anand Vihar", 28.6467, 77.3154],
        ["Karkarduma", 28.6493, 77.3061], ["Karkarduma Court", 28.6536, 77.2958],
        ["Krishna Nagar", 28.6578, 77.2901], ["East Azad Nagar", 28.6647, 77.2848],
        ["Welcome", 28.6723, 77.2769], ["Jaffrabad", 28.6827, 77.2748],
        ["Maujpur-Babarpur", 28.6921, 77.2796], ["Gokulpuri", 28.7025, 77.2861],
        ["Johri Enclave", 28.7129, 77.2901], ["Shiv Vihar", 28.7214, 77.2894],
      ],
    },
    pinkbranch: {
      id: "pinkbranch", code: "PB", name: "Pink Line", group: "pink", branch: "Maujpur extension", color: "#EE6F9C",
      stations: [
        ["Maujpur-Babarpur", 28.6922, 77.2795], ["Yamuna Vihar", 28.7024, 77.2773],
        ["Bhajanpura", 28.7036, 77.2626], ["Khajuri Khas", 28.7051, 77.2545],
        ["Nanaksar - Sonia Vihar", 28.7086, 77.2425], ["Soorghat", 28.7102, 77.2274],
        ["Jagatpur - Wazirabad", 28.7211, 77.2239], ["Jharoda Majra", 28.7249, 77.2137],
        ["Burari", 28.7299, 77.1993], ["Majlis Park", 28.7241, 77.1821],
      ],
    },
    magenta: {
      id: "magenta", code: "MA", name: "Magenta Line", group: "magenta", color: "#C2338B",
      stations: [
        ["Botanical Garden", 28.5639, 77.3339], ["Okhla Bird Sanctuary", 28.5529, 77.3216],
        ["Kalindi Kunj", 28.5429, 77.3101], ["Jasola Vihar Shaheen Bagh", 28.5458, 77.2966],
        ["Okhla Vihar", 28.5613, 77.2918], ["Jamia Millia Islamia", 28.563, 77.2864],
        ["Sukhdev Vihar", 28.5598, 77.275], ["Okhla NSIC", 28.5544, 77.2648],
        ["Kalkaji Mandir", 28.5501, 77.2567], ["Nehru Enclave", 28.546, 77.2515],
        ["Greater Kailash", 28.5419, 77.2385], ["Chirag Delhi", 28.5411, 77.2303],
        ["Panchsheel Park", 28.5424, 77.2211], ["Hauz Khas", 28.5434, 77.205],
        ["IIT Delhi", 28.547, 77.1945], ["RK Puram", 28.5504, 77.1855],
        ["Munirka", 28.5569, 77.175], ["Vasant Vihar", 28.5578, 77.1611],
        ["Shankar Vihar", 28.5608, 77.1403], ["Terminal 1 IGI Airport", 28.5649, 77.1226],
        ["Sadar Bazar Cantonment", 28.5771, 77.1111], ["Palam", 28.5889, 77.083],
        ["Dashrath Puri", 28.6019, 77.0824], ["Dabri Mor - Janakpuri South", 28.6158, 77.0852],
        ["Janakpuri West", 28.629, 77.0779], ["Krishna Park Extension", 28.6478, 77.0843],
      ],
    },
    magentabranch: {
      id: "magentabranch", code: "MX", name: "Magenta Line", group: "magenta", branch: "Majlis Park extension", color: "#C2338B",
      stations: [
        ["Deepali Chowk", 28.6981, 77.1183], ["Madhuban Chowk", 28.7036, 77.1301],
        ["North Pitampura - Prashant Vihar", 28.7131, 77.1387], ["Haiderpur Village", 28.7249, 77.1424],
        ["Haiderpur Badli Mor", 28.7298, 77.1488], ["Bhalaswa", 28.7369, 77.1681],
        ["Majlis Park", 28.7241, 77.1816],
      ],
    },
    grey: {
      id: "grey", code: "GR", name: "Grey Line", group: "grey", color: "#8A8F99",
      stations: [
        ["Dwarka", 28.6159, 77.0224], ["Nangli", 28.6173, 77.0105],
        ["Najafgarh", 28.6124, 76.9866], ["Dhansa Bus Stand", 28.6119, 76.9785],
      ],
    },
    airport: {
      id: "airport", code: "AE", name: "Airport Express", group: "airport", color: "#F28C1A",
      stations: [
        ["Yashobhoomi Dwarka Sector 25", 28.5509, 77.0453], ["Dwarka Sector 21", 28.5518, 77.0586],
        ["IGI Airport", 28.5565, 77.0867], ["Delhi Aerocity", 28.5488, 77.1208],
        ["Dhaula Kuan", 28.5919, 77.1617], ["Shivaji Stadium", 28.6289, 77.2113],
        ["New Delhi", 28.6425, 77.2231],
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

  // One entry per coloured line, with its branches: { blue: { name: "Blue", color, lines: [...] } }
  const GROUPS = {};
  Object.values(LINES).forEach(line => {
    const g = GROUPS[line.group] || (GROUPS[line.group] = { id: line.group, name: line.name.replace(/ Line$/, ""), color: line.color, lines: [] });
    g.lines.push(line.id);
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
    LINES, GROUPS, TIME_SLOTS, DAY_PARTS, stationIndex, terminalDepartures,
    istParts, istDayStartMs, fmtTime,
    livePositions, nextArrivals, legsForPath, scheduleLegs, departures, stationNames,
  };
});
