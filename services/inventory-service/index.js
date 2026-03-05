const express = require("express");
const app = express();
app.use(express.json());

app.get("/inventory",(req,res)=>{
  res.json([
    {food:"bread",qty:10},
    {food:"milk",qty:5}
  ])
})

app.post("/inventory/update",(req,res)=>{
  res.json({message:"inventory updated"})
})

app.listen(3000)