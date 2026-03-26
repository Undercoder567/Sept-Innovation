# 🐍 Python Analytics Engine - Installation Guide

Complete guide to set up the Python analytics engine for Sept Innovation.

---

## Prerequisites

### System Requirements
- **Python**: 3.8 or higher
- **pip**: Package manager for Python
- **Virtual Environment**: Recommended (venv or conda)
- **Memory**: 2GB+ RAM
- **Disk Space**: 500MB+

### Check Your Setup

```powershell
# Check Python version
python --version
# Expected: Python 3.8.0 or higher

# Check pip
pip --version
# Expected: pip 20.0+ (python 3.x)
```

---

## Installation Steps

### Step 1: Create Virtual Environment (Recommended)

**Option A: Using venv (Built-in)**

```powershell
# Navigate to analytics engine directory
cd e:\SeptInnovation\backend\analytics-engine

# Create virtual environment
python -m venv venv

# Activate it (Windows)
.\venv\Scripts\Activate.ps1

# Activate it (macOS/Linux)
source venv/bin/activate

# Expected: (venv) appears in terminal
```

**Option B: Using conda**

```powershell
# Create conda environment
conda create -n sept-analytics python=3.10

# Activate
conda activate sept-analytics
```

### Step 2: Install Dependencies

```powershell
# Make sure you're in the analytics-engine directory
cd e:\SeptInnovation\backend\analytics-engine

# Activate virtual environment (if using one)
.\venv\Scripts\Activate.ps1

# Install all requirements
pip install -r requirements.txt

# Expected output:
# Successfully installed numpy-1.24.3 pandas-2.0.3 scipy-1.11.2 ...
```

### Step 3: Verify Installation

```powershell
# Test Python imports
python -c "import numpy, pandas, scipy, sklearn, matplotlib, seaborn, statsmodels, flask; print('✅ All packages installed successfully')"

# Check specific versions
python -c "import pandas; print(f'Pandas: {pandas.__version__}')"
python -c "import numpy; print(f'NumPy: {numpy.__version__}')"
python -c "import sklearn; print(f'Scikit-learn: {sklearn.__version__}')"
```

---

## Project Structure

```
analytics-engine/
├── app/
│   ├── __init__.py
│   ├── main.py              # Statistical analysis
│   ├── trend_analysis.py    # Time-series analysis
│   ├── growth.py            # Growth metrics
│   ├── explainers.py        # Insight generation
│   └── insights.py          # Insight formatting
├── requirements.txt
├── setup.py                 # (Optional) For pip installation
├── venv/                    # Virtual environment
└── README.md
```

---

## Usage

### Option 1: As Python Module (From Node.js Backend)

The Python engine is called from the Node.js backend:

```typescript
// In insightGenerator.ts
const response = await axios.post(
  'http://localhost:5000/api/analyze',
  {
    data: result.rows,
    query: userQuery,
    columns: result.columns
  }
);
```

### Option 2: Direct Python Usage

```powershell
# Activate virtual environment
cd analytics-engine
.\venv\Scripts\Activate.ps1

# Run Python interactive shell
python

# In Python:
from app.main import analyze_data
import pandas as pd

data = pd.DataFrame({
    'date': ['2024-01-01', '2024-01-02', '2024-01-03'],
    'revenue': [1000, 1500, 1200]
})

results = analyze_data(data)
print(results)
```

### Option 3: Start Flask API Server

```powershell
# Activate virtual environment
.\venv\Scripts\Activate.ps1

# Start Flask server
python -m flask run --port=5000

# Expected output:
# WARNING: This is a development server...
# Running on http://127.0.0.1:5000
```

Then call the API:

```powershell
# Test endpoint
curl -X POST http://localhost:5000/api/analyze `
  -H "Content-Type: application/json" `
  -d '{
    "data": [{"revenue": 1000}, {"revenue": 1500}],
    "query": "revenue analysis",
    "columns": ["revenue"]
  }'
```

---

## Package Descriptions

### Core Scientific Computing

| Package | Purpose | Version |
|---------|---------|---------|
| **numpy** | Numerical arrays and mathematics | 1.24.3 |
| **pandas** | Data manipulation and analysis | 2.0.3 |
| **scipy** | Scientific computing (stats, optimization) | 1.11.2 |
| **scikit-learn** | Machine learning algorithms | 1.3.1 |

### Visualization

| Package | Purpose | Version |
|---------|---------|---------|
| **matplotlib** | 2D plotting library | 3.7.2 |
| **seaborn** | Statistical visualization | 0.12.2 |

### Advanced Analytics

| Package | Purpose | Version |
|---------|---------|---------|
| **statsmodels** | Statistical models and tests | 0.14.0 |

### Web Framework

| Package | Purpose | Version |
|---------|---------|---------|
| **Flask** | Web framework for API | 2.3.2 |
| **Werkzeug** | WSGI utilities | 2.3.6 |

### Utilities

| Package | Purpose | Version |
|---------|---------|---------|
| **python-dotenv** | Load environment variables | 1.0.0 |
| **requests** | HTTP library for API calls | 2.31.0 |
| **openpyxl** | Excel file handling | 3.1.2 |
| **jsonschema** | JSON validation | 4.19.0 |

---

## Common Commands

```powershell
# Activate environment
.\venv\Scripts\Activate.ps1

# Install new package
pip install package_name

# Upgrade package
pip install --upgrade package_name

# List installed packages
pip list

# Export current environment
pip freeze > requirements.txt

# Check for outdated packages
pip list --outdated

# Deactivate environment
deactivate
```

---

## Troubleshooting

### Problem: "Python is not recognized"

**Solution:**
```powershell
# Add Python to PATH
# Or use full path
C:\Users\YourUsername\AppData\Local\Programs\Python\Python310\python.exe --version

# Or reinstall Python with "Add Python to PATH" option
```

### Problem: "No module named 'pandas'"

**Solution:**
```powershell
# Make sure virtual environment is activated
.\venv\Scripts\Activate.ps1

# Reinstall requirements
pip install -r requirements.txt
```

### Problem: Permission denied on Windows

**Solution:**
```powershell
# Run PowerShell as Administrator
# Then:
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
.\venv\Scripts\Activate.ps1
```

### Problem: Slow pip install

**Solution:**
```powershell
# Use different PyPI mirror
pip install -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/

# Or upgrade pip
python -m pip install --upgrade pip
```

### Problem: Version conflicts

**Solution:**
```powershell
# Create fresh virtual environment
Remove-Item venv -Recurse -Force
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### Problem: Out of Memory during install

**Solution:**
```powershell
# Install one package at a time
pip install numpy
pip install pandas
pip install scipy
# ... etc
```

---

## Integration with Node.js Backend

The Python engine is called from `src/analytics/insightGenerator.ts`:

```typescript
async callPythonAnalyticsEngine(
  result: QueryResult,
  query: string
): Promise<PythonAnalysisResponse | null> {
  try {
    const response = await axios.post<PythonAnalysisResponse>(
      `${this.pythonEngineUrl}/api/analyze`,
      {
        data: result.rows,
        query,
        columns: result.columns
      },
      { timeout: 10000 }
    );

    return response.data.status === 'success' ? response.data : null;
  } catch (error) {
    console.warn('Python analytics engine unavailable:', error);
    return null;  // Fallback to basic analysis
  }
}
```

### Configuration

Update environment variables in `backend/.env`:

```env
# Python Analytics Engine (optional)
PYTHON_ENGINE_URL=http://localhost:5000
PYTHON_ENGINE_ENABLED=true
PYTHON_ENGINE_TIMEOUT=10000
```

---

## Development Workflow

### 1. Activate Environment

```powershell
cd e:\SeptInnovation\backend\analytics-engine
.\venv\Scripts\Activate.ps1
```

### 2. Work on Python Code

Edit files in `app/`:
- `main.py` - Add new analysis functions
- `trend_analysis.py` - Time-series methods
- `growth.py` - Growth metrics
- `explainers.py` - Insight generation

### 3. Test Changes

```powershell
# Run specific module
python -m app.main

# Or test in interactive shell
python
>>> from app.main import analyze_data
>>> analyze_data(data)
```

### 4. Update Requirements

When adding new packages:

```powershell
pip install new_package
pip freeze > requirements.txt
```

---

## Performance Tips

### 1. Use NumPy for Vectorization

```python
# ❌ Slow - Loop through each row
result = []
for row in data:
    result.append(row['value'] * 2)

# ✅ Fast - NumPy vectorization
result = data['value'].values * 2
```

### 2. Cache Results

```python
from functools import lru_cache

@lru_cache(maxsize=128)
def expensive_calculation(data):
    # Only computed once per unique input
    return data.mean()
```

### 3. Use Efficient Data Types

```python
# ❌ Uses more memory
df['amount'] = df['amount'].astype('float64')

# ✅ Uses less memory
df['amount'] = df['amount'].astype('float32')
```

### 4. Batch Processing

```python
# Process large datasets in chunks
chunk_size = 10000
for chunk in pd.read_csv('large_file.csv', chunksize=chunk_size):
    process_chunk(chunk)
```

---

## Production Deployment

### Option 1: Using Gunicorn (Recommended)

```powershell
# Install Gunicorn
pip install gunicorn

# Run with multiple workers
gunicorn --workers 4 --bind 0.0.0.0:5000 app:app
```

### Option 2: Using Docker

Create `Dockerfile`:

```dockerfile
FROM python:3.10-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["python", "-m", "flask", "run", "--host=0.0.0.0"]
```

Build and run:

```bash
docker build -t sept-analytics .
docker run -p 5000:5000 sept-analytics
```

### Option 3: As Systemd Service (Linux)

Create `/etc/systemd/system/sept-analytics.service`:

```ini
[Unit]
Description=Sept Innovation Analytics Engine
After=network.target

[Service]
Type=simple
User=sept-user
WorkingDirectory=/opt/sept-analytics
ExecStart=/opt/sept-analytics/venv/bin/python -m flask run --host=0.0.0.0 --port=5000
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable:

```bash
sudo systemctl enable sept-analytics
sudo systemctl start sept-analytics
```

---

## Monitoring

### Memory Usage

```python
import psutil
import os

process = psutil.Process(os.getpid())
memory_info = process.memory_info()
print(f"Memory: {memory_info.rss / 1024 / 1024:.2f} MB")
```

### Performance Profiling

```python
import cProfile

cProfile.run('expensive_function()')
```

### Logging

```python
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

logger.info("Starting analysis")
logger.error("Analysis failed")
```

---

## References

- [NumPy Documentation](https://numpy.org/doc/)
- [Pandas Documentation](https://pandas.pydata.org/docs/)
- [Scikit-learn Documentation](https://scikit-learn.org/stable/)
- [Flask Documentation](https://flask.palletsprojects.com/)
- [Python Virtual Environments](https://docs.python.org/3/tutorial/venv.html)

---

## Next Steps

1. ✅ Install dependencies (`pip install -r requirements.txt`)
2. ✅ Test imports (run verification commands)
3. ✅ Review `app/main.py` for available functions
4. ✅ Start Node.js backend (which calls this engine)
5. ✅ Monitor logs for performance

Ready to analyze data! 🚀
