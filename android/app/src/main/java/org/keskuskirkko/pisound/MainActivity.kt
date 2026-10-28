package org.keskuskirkko.pisound

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import org.keskuskirkko.pisound.ui.screens.WirelessMicsScreen
import org.keskuskirkko.pisound.ui.theme.PiSoundTheme
import org.keskuskirkko.pisound.viewmodel.SoundViewModel

class MainActivity : ComponentActivity() {
    private val soundViewModel: SoundViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            PiSoundTheme {
                WirelessMicsScreen(viewModel = soundViewModel)
            }
        }
    }
}
