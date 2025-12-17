/**
 * Mock Data Generators for Charts
 * These immediate-invoked functions return random data for visualization demos
 */
export const dailyActivity = (() => {
  const days = 30
  const randInt = (min: number, max: number) =>
    Math.floor(Math.random() * (max - min + 1)) + min
  return Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    runs: randInt(120, 220), // 120-220
    jobs: randInt(110, 170), // 110-170
    errors: randInt(5, 20), // 5-20
    duration: randInt(300, 500), // 300-500
  }))
})()

/**
 * Generates mock monthly activity data
 */
export const monthlyActivity = (() => {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ]
  const randInt = (min: number, max: number) =>
    Math.floor(Math.random() * (max - min + 1)) + min
  return months.map((m) => ({
    name: m,
    total: randInt(500, 2500), // 500-2500
    predicted: randInt(500, 2500), // 500-2500
  }))
})()

/**
 * Generates mock yearly activity data
 */
export const yearlyActivity = (() => {
  const startYear = 1970
  const endYear = 2021
  const min = 0.8
  const max = 2.6

  const rand = () => Number((min + Math.random() * (max - min)).toFixed(2))

  return Array.from({ length: endYear - startYear + 1 }, (_, i) => ({
    year: startYear + i,
    "Export Growth Rate": rand(),
    "Import Growth Rate": rand(),
  }))
})()
