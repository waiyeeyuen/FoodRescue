const express = require("express");
const app = express();

app.get("/recommendation", (req,res)=>{
  res.json([
    {food:"bread"},
    {food:"milk"}
  ])
})

app.listen(3000,()=>{
  console.log("recommendation service running")
})