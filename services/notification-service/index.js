const express = require("express");
const app = express();

app.post("/notify",(req,res)=>{
  res.json({message:"notification sent"})
})

app.listen(3000)