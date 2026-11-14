plugins {
    id("com.android.application")
    id("com.chaquo.python")
}

android {
    namespace = "org.spaceapps.crewhealthhub"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.spaceapps.crewhealthhub"
        minSdk = 24
        targetSdk = 34          // 35 would force edge-to-edge drawing under the status bar
        versionCode = 2
        versionName = "1.1.0"
        ndk {
            abiFilters += listOf("arm64-v8a")   // 64-bit ARM phones (Python 3.12 has no 32-bit build)
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

chaquopy {
    defaultConfig {
        version = "3.12"
        pip {
            install("-r", "requirements.txt")
        }
    }
}
