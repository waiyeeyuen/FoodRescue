app.post("/checkout", async(req,res)=>{

    const payment = await axios.post(
      "http://payment-service:3000/pay"
    )
  
    res.json(payment.data)
  
  })