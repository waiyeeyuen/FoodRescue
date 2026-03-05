const express = require("express");
const app = express();

app.post("/pay",(req,res)=>{
  res.json({status:"payment success"})
})

app.listen(3000)