const fs = require("fs");

function toSeconds(timeStr) {
    if (!timeStr) return 0;
    let parts = timeStr.trim().split(" ");
    let hms = parts[0].split(":").map(Number);
    let hours = hms[0] || 0;
    let minutes = hms[1] || 0;
    let seconds = hms[2] || 0;

    if (parts.length > 1) {
        let period = parts[1].toLowerCase();
        if (period === "pm" && hours !== 12) hours += 12;
        if (period === "am" && hours === 12) hours = 0;
    }

    return hours * 3600 + minutes * 60 + seconds;
}

function formatTime(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;

    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getShiftDuration(startTime, endTime) {
    let startSec = toSeconds(startTime);
    let endSec = toSeconds(endTime);

    if (endSec < startSec) endSec += 24 * 3600;
    return formatTime(endSec - startSec);
}

function getIdleTime(startTime, endTime) {
    const start = toSeconds(startTime);
    const end = toSeconds(endTime);
    const workStart = 8 * 3600; 
    const workEnd = 22 * 3600; 
    let idle = 0;


    if (start < workStart) {
        idle += Math.min(end, workStart) - start;
    }

    if (end > workEnd) {
        idle += end - Math.max(start, workEnd);
    }
    return formatTime(idle);
}

function getActiveTime(shiftDuration, idleTime) {
    const activeSec = Math.max(0, toSeconds(shiftDuration) - toSeconds(idleTime));
    return formatTime(activeSec);
}

function metQuota(date, activeTime) {
    const activeSeconds = toSeconds(activeTime);
    const currentDate = new Date(date);
    const eidStart = new Date("2025-04-10");
    const eidEnd = new Date("2025-04-30");

    const isEid = currentDate >= eidStart && currentDate <= eidEnd;
    const quotaSeconds = isEid ? (6 * 3600) : (8 * 3600 + 24 * 60);
    return activeSeconds >= quotaSeconds;
}

function addShiftRecord(textFile, shiftObj) {
    const fileContent = fs.existsSync(textFile) ? fs.readFileSync(textFile, "utf8") : "";
    const lines = fileContent.trim() ? fileContent.split(/\r?\n/) : [];

    for (const line of lines) {
        const parts = line.split(",");
        if (parts[0] === shiftObj.driverID && parts[2] === shiftObj.date) return {};
    }

    const duration = getShiftDuration(shiftObj.startTime, shiftObj.endTime);
    const idle = getIdleTime(shiftObj.startTime, shiftObj.endTime);
    const active = getActiveTime(duration, idle);
    const quota = metQuota(shiftObj.date, active);

    const record = {
        ...shiftObj,
        shiftDuration: duration,
        idleTime: idle,
        activeTime: active,
        metQuota: quota,
        hasBonus: false
    };

    const csvRow = Object.values(record).join(",");

    let lastIndex = lines.length;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith(shiftObj.driverID + ",")) lastIndex = i + 1;
    }
    lines.splice(lastIndex, 0, csvRow);

    fs.writeFileSync(textFile, lines.join("\n") + "\n");
    return record;
}

function setBonus(textFile, driverID, date, newValue) {
    if (!fs.existsSync(textFile)) return;
    const lines = fs.readFileSync(textFile, "utf8").split(/\r?\n/);
    const updated = lines.map(line => {
        const p = line.split(",");
        if (p[0] === driverID && p[2] === date) {
            p[9] = String(newValue);
            return p.join(",");
        }
        return line;
    });
    fs.writeFileSync(textFile, updated.join("\n"));
}

function countBonusPerMonth(textFile, driverID, month) {
    if (!fs.existsSync(textFile)) return -1;
    const lines = fs.readFileSync(textFile, "utf8").split(/\r?\n/);
    let found = false;
    let count = 0;
    const targetMonth = String(month).padStart(2, "0");

    for (const line of lines) {
        const p = line.split(",");
        if (p[0] === driverID) {
            found = true;
            if (p[2].split("-")[1] === targetMonth && p[9]?.trim() === "true") count++;
        }
    }
    return found ? count : -1;
}

function getTotalActiveHoursPerMonth(textFile, driverID, month) {
    if (!fs.existsSync(textFile)) return "0:00:00";
    const lines = fs.readFileSync(textFile, "utf8").split(/\r?\n/);
    let totalSec = 0;
    for (const line of lines) {
        const p = line.split(",");
        if (p[0] === driverID && Number(p[2].split("-")[1]) === Number(month)) {
            totalSec += toSeconds(p[7]);
        }
    }
    return formatTime(totalSec);
}

function getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month) {
    if (!fs.existsSync(rateFile)) return "0:00:00";
    const rates = fs.readFileSync(rateFile, "utf8").split(/\r?\n/);
    const rateLine = rates.find(l => l.startsWith(driverID));
    if (!rateLine) return "0:00:00";

    const dayOff = rateLine.split(",")[1].trim().toLowerCase();
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

    const shiftData = fs.existsSync(textFile) ? fs.readFileSync(textFile, "utf8").split(/\r?\n/) : [];
    let totalReq = 0;

    for (const line of shiftData) {
        const p = line.split(",");
        if (p[0] === driverID && Number(p[2].split("-")[1]) === Number(month)) {
            const d = new Date(p[2]);
            if (days[d.getDay()] !== dayOff) {
                totalReq += (d >= new Date("2025-04-10") && d <= new Date("2025-04-30")) 
                            ? (6 * 3600) : (8 * 3600 + 1440);
            }
        }
    }
    return formatTime(Math.max(0, totalReq - (bonusCount * 7200)));
}

function getNetPay(driverID, actualHours, requiredHours, rateFile) {
    if (!fs.existsSync(rateFile)) return 0;

    let lines = fs.readFileSync(rateFile, "utf8").trim().split(/\r?\n/);

    let tier = null;
    let basePay = null;

    for (let line of lines) {
        let parts = line.split(",");
        if (parts[0] === driverID) {
            tier = Number(parts[3]);
            basePay = Number(parts[2]);
            break;
        }
    }

    if (tier === null || basePay === null) return 0;

    const allowedMissing = { 1: 50, 2: 20, 3: 10, 4: 3 };

    let actualSec = toSeconds(actualHours);
    let requiredSec = toSeconds(requiredHours);

    if (actualSec >= requiredSec) return basePay;

    let missingSeconds = requiredSec - actualSec;
    let missingHours = Math.floor(missingSeconds / 3600);

    let effectiveMissing = missingHours - allowedMissing[tier];

    if (effectiveMissing <= 0) return basePay;

    let deductionRatePerHour = Math.floor(basePay / 185);

    let totalDeduction = effectiveMissing * deductionRatePerHour;
    let netPay = basePay - totalDeduction;

    return netPay;
}

module.exports = {
    getShiftDuration, getIdleTime, getActiveTime, metQuota,
    addShiftRecord, setBonus, countBonusPerMonth,
    getTotalActiveHoursPerMonth, getRequiredHoursPerMonth, getNetPay
};