app.post("/expiry-food", async(req,res)=>{

    await axios.post(
      "http://inventory-service:3000/inventory/update"
    )
  
    res.json({message:"expired food removed"})
  })