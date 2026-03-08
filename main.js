const fs = require("fs");

// ============================================================
// Function 1: getShiftDuration(startTime, endTime)
// startTime: (typeof string) formatted as hh:mm:ss am or hh:mm:ss pm
// endTime: (typeof string) formatted as hh:mm:ss am or hh:mm:ss pm
// Returns: string formatted as h:mm:ss
// ============================================================
function toSeconds(timeStr) {
    let parts = timeStr.split(" ");
    let [hours, minutes, seconds] = parts[0].split(":").map(Number);

    if (parts.length > 1) {
        let period = parts[1].toLowerCase();
        if (period === "pm" && hours !== 12) hours += 12;
        if (period === "am" && hours === 12) hours = 0;
    }

    return hours * 3600 + minutes * 60 + seconds;
}
function getShiftDuration(startTime, endTime) {

  let startSeconds = toSeconds(startTime);
  let endSeconds = toSeconds(endTime);

  if (endSeconds < startSeconds) {
    endSeconds += 24 * 3600;
  }

  let diff = endSeconds - startSeconds;

  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;

  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ============================================================
// Function 2: getIdleTime(startTime, endTime)
// startTime: (typeof string) formatted as hh:mm:ss am or hh:mm:ss pm
// endTime: (typeof string) formatted as hh:mm:ss am or hh:mm:ss pm
// Returns: string formatted as h:mm:ss
// ============================================================
function getIdleTime(startTime, endTime) {

    function format(seconds) {
        let h = Math.floor(seconds / 3600);
        let m = Math.floor((seconds % 3600) / 60);
        let s = seconds % 60;

        return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }

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

    return format(idle);
}

// ============================================================
// Function 3: getActiveTime(shiftDuration, idleTime)
// shiftDuration: (typeof string) formatted as h:mm:ss
// idleTime: (typeof string) formatted as h:mm:ss
// Returns: string formatted as h:mm:ss
// ============================================================
function getActiveTime(shiftDuration, idleTime) {

    function format(seconds) {
        let h = Math.floor(seconds / 3600);
        let m = Math.floor((seconds % 3600) / 60);
        let s = seconds % 60;

        return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }

    let shiftSec = toSeconds(shiftDuration);
    let idleSec = toSeconds(idleTime);

    let activeSec = shiftSec - idleSec;

    return format(activeSec);
}

// ============================================================
// Function 4: metQuota(date, activeTime)
// date: (typeof string) formatted as yyyy-mm-dd
// activeTime: (typeof string) formatted as h:mm:ss
// Returns: boolean
// ============================================================
function metQuota(date, activeTime) {

    const activeSeconds = toSeconds(activeTime);

    const eidStart = new Date("2025-04-10");
    const eidEnd = new Date("2025-04-30");
    const currentDate = new Date(date);

    let quotaSeconds;

    if (currentDate >= eidStart && currentDate <= eidEnd) {
        quotaSeconds = 6 * 3600;
    } else {
        quotaSeconds = 8 * 3600 + 24 * 60;
    }

    return activeSeconds >= quotaSeconds;
}

// ============================================================
// Function 5: addShiftRecord(textFile, shiftObj)
// textFile: (typeof string) path to shifts text file
// shiftObj: (typeof object) has driverID, driverName, date, startTime, endTime
// Returns: object with 10 properties or empty object {}
// ============================================================
function addShiftRecord(textFile, shiftObj) {

    function format(seconds) {
        let h = Math.floor(seconds / 3600);
        let m = Math.floor((seconds % 3600) / 60);
        let s = seconds % 60;
        return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
    }

    function convert12to24(t){
        let [time, p] = t.split(" ");
        let [h,m,s] = time.split(":").map(Number);
        if(p.toLowerCase()==="pm" && h!==12) h+=12;
        if(p.toLowerCase()==="am" && h===12) h=0;
        return h*3600+m*60+s;
    }

    const fileData = fs.existsSync(textFile) ? fs.readFileSync(textFile,"utf8") : "";
    const lines = fileData.trim() === "" ? [] : fileData.split("\n");

    for (let line of lines) {
        let parts = line.split(",");
        if (parts[0] === shiftObj.driverID && parts[2] === shiftObj.date) {
            return {};
        }
    }

    const start = convert12to24(shiftObj.startTime);
    const end = convert12to24(shiftObj.endTime);
    const shiftDuration = format(end - start);

    const idleTime = getIdleTime(shiftObj.startTime, shiftObj.endTime);
    const activeTime = getActiveTime(shiftDuration, idleTime);
    const quota = metQuota(shiftObj.date, activeTime);

    const newRecord = {
        driverID: shiftObj.driverID,
        driverName: shiftObj.driverName,
        date: shiftObj.date,
        startTime: shiftObj.startTime,
        endTime: shiftObj.endTime,
        shiftDuration: shiftDuration,
        idleTime: idleTime,
        activeTime: activeTime,
        metQuota: quota,
        hasBonus: false
    };

    const recordLine = Object.values(newRecord).join(",");

    let insertIndex = lines.length;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith(shiftObj.driverID + ",")) {
            insertIndex = i + 1;
        }
    }

    lines.splice(insertIndex, 0, recordLine);

    fs.writeFileSync(textFile, lines.join("\n"));

    return newRecord;
}

// ============================================================
// Function 6: setBonus(textFile, driverID, date, newValue)
// textFile: (typeof string) path to shifts text file
// driverID: (typeof string)
// date: (typeof string) formatted as yyyy-mm-dd
// newValue: (typeof boolean)
// Returns: nothing (void)
// ============================================================
function setBonus(textFile, driverID, date, newValue) {
    if (!fs.existsSync(textFile)) return;

    let lines = fs.readFileSync(textFile, "utf8").trim().split("\n");

    for (let i = 0; i < lines.length; i++) {

        let parts = lines[i].split(",");

        if (parts[0] === driverID && parts[2] === date) {
            parts[9] = newValue;
            lines[i] = parts.join(",");
            break;
        }
    }

    fs.writeFileSync(textFile, lines.join("\n"));
}

// ============================================================
// Function 7: countBonusPerMonth(textFile, driverID, month)
// textFile: (typeof string) path to shifts text file
// driverID: (typeof string)
// month: (typeof string) formatted as mm or m
// Returns: number (-1 if driverID not found)
// ============================================================
function countBonusPerMonth(textFile, driverID, month) {
   if (!fs.existsSync(textFile)) return -1;

    let lines = fs.readFileSync(textFile, "utf8").trim().split("\n");

    let driverFound = false;
    let count = 0;

    month = month.padStart(2, "0");

    for (let line of lines) {

        let parts = line.split(",");

        if (parts[0] === driverID) {
            driverFound = true;

            let recordMonth = parts[2].split("-")[1];

            if (recordMonth === month && parts[9] === "true") {
                count++;
            }
        }
    }

    if (!driverFound) return -1;

    return count;
}

// ============================================================
// Function 8: getTotalActiveHoursPerMonth(textFile, driverID, month)
// textFile: (typeof string) path to shifts text file
// driverID: (typeof string)
// month: (typeof number)
// Returns: string formatted as hhh:mm:ss
// ============================================================
function getTotalActiveHoursPerMonth(textFile, driverID, month) {
    if (!fs.existsSync(textFile)) return "000:00:00";

    let lines = fs.readFileSync(textFile, "utf8").trim().split("\n");

    let totalSeconds = 0;

    function format(seconds) {
        let h = Math.floor(seconds / 3600);
        let m = Math.floor((seconds % 3600) / 60);
        let s = seconds % 60;

        return `${String(h).padStart(3, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }

    for (let line of lines) {

        let parts = line.split(",");

        if (parts[0] === driverID) {

            let recordMonth = Number(parts[2].split("-")[1]);

            if (recordMonth === month) {
                totalSeconds += toSeconds(parts[7]);
            }
        }
    }

    return format(totalSeconds);
}

// ============================================================
// Function 9: getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month)
// textFile: (typeof string) path to shifts text file
// rateFile: (typeof string) path to driver rates text file
// bonusCount: (typeof number) total bonuses for given driver per month
// driverID: (typeof string)
// month: (typeof number)
// Returns: string formatted as hhh:mm:ss
// ============================================================
function getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month) {
    if (!fs.existsSync(textFile) || !fs.existsSync(rateFile)) return "000:00:00";

    let ratesLines = fs.readFileSync(rateFile, "utf8").trim().split("\n");
    let driverDayOff = "";

    for (let line of ratesLines) {
        let parts = line.split(",");
        if (parts[0] === driverID) {
            driverDayOff = parts[1].trim().toLowerCase(); 
            break;
        }
    }

    let shiftsLines = fs.readFileSync(textFile, "utf8").trim().split("\n");
    let totalSeconds = 0;

    const normalQuota = 8 * 3600 + 24 * 60; 
    const eidQuota = 6 * 3600; 
    const eidStart = new Date("2025-04-10");
    const eidEnd = new Date("2025-04-30");

    const daysOfWeek = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

    for (let line of shiftsLines) {
        let parts = line.split(",");

        if (parts[0] === driverID) {
            let dateStr = parts[2];
            let recordMonth = Number(dateStr.split("-")[1]);

            if (recordMonth === month) {
                let currentDate = new Date(dateStr);
                let shiftDayName = daysOfWeek[currentDate.getDay()];

                if (shiftDayName !== driverDayOff) {
                    if (currentDate >= eidStart && currentDate <= eidEnd) {
                        totalSeconds += eidQuota;
                    } else {
                        totalSeconds += normalQuota;
                    }
                }
            }
        }
    }

    totalSeconds -= bonusCount * (2 * 3600);

    if (totalSeconds < 0) totalSeconds = 0;
    
    let h = Math.floor(totalSeconds / 3600);
    let m = Math.floor((totalSeconds % 3600) / 60);
    let s = totalSeconds % 60;

    return `${String(h).padStart(3, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ============================================================
// Function 10: getNetPay(driverID, actualHours, requiredHours, rateFile)
// driverID: (typeof string)
// actualHours: (typeof string) formatted as hhh:mm:ss
// requiredHours: (typeof string) formatted as hhh:mm:ss
// rateFile: (typeof string) path to driver rates text file
// Returns: integer (net pay)
// ============================================================
function getNetPay(driverID, actualHours, requiredHours, rateFile) {

    if (!fs.existsSync(rateFile)) return 0;

    let lines = fs.readFileSync(rateFile, "utf8").trim().split("\n");

    let tier = null;
    let basePay = null;

    for (let line of lines) {
        let parts = line.split(",");
        if (parts[0] === driverID) {
            tier = Number(parts[2]);
            basePay = Number(parts[3]);
            break;
        }
    }

    if (tier === null) return 0;

    const allowedMissing = {
        1: 50,
        2: 20,
        3: 10,
        4: 3
    };

    let actualSec = toSeconds(actualHours);
    let requiredSec = toSeconds(requiredHours);

    if (actualSec >= requiredSec) return basePay;

    let missingSeconds = requiredSec - actualSec;
    let missingHours = Math.floor(missingSeconds / 3600);

    let effectiveMissing = missingHours - allowedMissing[tier];

    if (effectiveMissing < 0) effectiveMissing = 0;

    let deductionRatePerHour = Math.floor(basePay / 185);

    let salaryDeduction = effectiveMissing * deductionRatePerHour;

    let netPay = basePay - salaryDeduction;

    return netPay;
}

module.exports = {
    getShiftDuration,
    getIdleTime,
    getActiveTime,
    metQuota,
    addShiftRecord,
    setBonus,
    countBonusPerMonth,
    getTotalActiveHoursPerMonth,
    getRequiredHoursPerMonth,
    getNetPay
};
