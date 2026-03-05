const express = require("express");
const app = express();

app.post("/error",(req,res)=>{
  console.log("error logged",req.body)
  res.json({status:"logged"})
})

app.listen(3000)