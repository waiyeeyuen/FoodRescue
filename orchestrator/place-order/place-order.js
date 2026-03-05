app.post("/place-order", async(req,res)=>{

    await axios.post(
      "http://order-service:3000/orders"
    )
  
    await axios.post(
      "http://inventory-service:3000/inventory/update"
    )
  
    await axios.post(
      "http://notification-service:3000/notify"
    )
  
    res.json({message:"order placed"})
  
  })