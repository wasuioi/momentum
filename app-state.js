export function syncCurrentDayState(currentDate, currentDay, editedDate, editedDay) {
  return currentDate === editedDate ? { ...editedDay } : currentDay;
}

export function checkpointMessage(time) {
  return `Target reached at ${time}`;
}
