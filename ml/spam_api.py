from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import joblib

app = FastAPI()

# Load model and vectorizer
model = joblib.load('ml/spam_model.joblib')
vectorizer = joblib.load('ml/vectorizer.joblib')

class Message(BaseModel):
    message: str

@app.post("/predict")
def predict_spam(message: Message):
    msg_vec = vectorizer.transform([message.message])
    prediction = model.predict(msg_vec)[0]
    return {"prediction": prediction}
