"""Run the API: python -m autodata"""
import uvicorn

if __name__ == "__main__":
    uvicorn.run("autodata.app:app", host="0.0.0.0", port=8000, reload=False)
