const express = require("express");
const axios = require("axios");

const app = express();

app.get("/recommendation", async(req,res)=>{

  const rec = await axios.get(
    "http://recommendation-service:3000/recommendation"
  )

  const inventory = await axios.get(
    "http://inventory-service:3000/inventory"
  )

  res.json({
    recommendation: rec.data,
    inventory: inventory.data
  })

})

app.listen(3000)