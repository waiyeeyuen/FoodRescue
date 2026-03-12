import express from "express";
import cors from "cors";

const app = express();
const PORT = 3001;
const BASE_URL =
  "https://personal-zxyqgjgl.outsystemscloud.com/FoodRescueRewardsSystem/rest/RewardAPI";

app.use(
  cors({
    origin: ["http://localhost:3000", "http://localhost:5173"],
  })
);
app.use(express.json());

app.get("/reward/eligibility/:userId", async (req, res) => {
  const { userId } = req.params;
  const response = await fetch(`${BASE_URL}/eligibility?UserId=${userId}`);
  const data = await response.json();
  res.status(response.status).json(data);
});

app.post("/reward/update", async (req, res) => {
  const { userId, voucherId } = req.body;
  const response = await fetch(`${BASE_URL}/UpdateStatus`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserId: userId, VoucherId: voucherId || "" }),
  });
  const data = await response.json();
  res.status(response.status).json(data);
});

app.listen(PORT, () => {
  console.log(`Reward service running on port ${PORT}`);
});
