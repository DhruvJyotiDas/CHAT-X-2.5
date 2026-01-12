import pandas as pd
import os
from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report
import joblib

# Get the directory of the current script
base_dir = os.path.dirname(__file__)

# Load dataset
data = pd.read_csv(os.path.join(base_dir, 'spam_dataset.csv'))

# Features and labels
X = data['message']
y = data['label']

# Split data
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# Vectorize text
vectorizer = TfidfVectorizer(stop_words='english', max_df=0.95, min_df=2)
X_train_vec = vectorizer.fit_transform(X_train)
X_test_vec = vectorizer.transform(X_test)

# Train model
model = LogisticRegression()
model.fit(X_train_vec, y_train)

# Evaluate
y_pred = model.predict(X_test_vec)
print(classification_report(y_test, y_pred))

# Save model and vectorizer
joblib.dump(model, os.path.join(base_dir, 'spam_model.joblib'))
joblib.dump(vectorizer, os.path.join(base_dir, 'vectorizer.joblib'))
