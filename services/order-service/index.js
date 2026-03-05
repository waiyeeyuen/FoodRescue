const express = require("express");
const app = express();
app.use(express.json());

app.post("/orders",(req,res)=>{
  res.json({message:"order created"})
})

app.listen(3000)