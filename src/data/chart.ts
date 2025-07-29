export const dailyActivity = Array.from({ length: 30 }, (_, index) => ({
  day: index + 1,
  runs: Math.floor(Math.random() * 100) + 120, // Random runs between 120-220
  jobs: Math.floor(Math.random() * 60) + 110, // Random jobs between 110-170
  errors: Math.floor(Math.random() * 15) + 5, // Random errors between 5-20
  duration: Math.floor(Math.random() * 200) + 300, // Random duration between 300-500
}))

export const monthlyActivity = [
  {
    name: "Jan",
    total: Math.floor(Math.random() * 2000) + 500,
    predicted: Math.floor(Math.random() * 2000) + 500,
  },
  {
    name: "Feb",
    total: Math.floor(Math.random() * 2000) + 500,
    predicted: Math.floor(Math.random() * 2000) + 500,
  },
  {
    name: "Mar",
    total: Math.floor(Math.random() * 2000) + 500,
    predicted: Math.floor(Math.random() * 2000) + 500,
  },
  {
    name: "Apr",
    total: Math.floor(Math.random() * 2000) + 500,
    predicted: Math.floor(Math.random() * 2000) + 500,
  },
  {
    name: "May",
    total: Math.floor(Math.random() * 2000) + 500,
    predicted: Math.floor(Math.random() * 2000) + 500,
  },
  {
    name: "Jun",
    total: Math.floor(Math.random() * 2000) + 500,
    predicted: Math.floor(Math.random() * 2000) + 500,
  },
  {
    name: "Jul",
    total: Math.floor(Math.random() * 2000) + 500,
    predicted: Math.floor(Math.random() * 2000) + 500,
  },
]
