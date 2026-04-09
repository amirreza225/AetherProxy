import 'package:aetherproxy/core/localization/translations.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

class QrCodeScannerDialog extends ConsumerWidget {
  const QrCodeScannerDialog({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = ref.read(translationsProvider).requireValue;
    return Scaffold(
      body: SafeArea(
        child: Stack(
          alignment: Alignment.center,
          children: [
            MobileScanner(
              placeholderBuilder: (context) => const Center(child: CircularProgressIndicator()),
              overlayBuilder: (context, constraints) => Container(
                width: MediaQuery.of(context).size.width * 0.7,
                height: MediaQuery.of(context).size.width * 0.7,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: Theme.of(context).colorScheme.primaryContainer, width: 4),
                ),
              ),
              errorBuilder: (context, error) => Center(child: Text(t.common.msg.permission.denied)),
              onDetect: (barcodes) {
                final rawData = barcodes.barcodes.first.rawValue;
                if (rawData != null) context.pop(rawData);
                // loggy.debug('captured raw: [$rawData]');
                // if (rawData != null) {
                //   context.pop(rawData);
                //   final uri = Uri.tryParse(rawData);
                //   if (context.mounted && uri != null) {
                //     // loggy.debug('captured url: [$uri]');
                //     context.pop(uri.toString());
                //   }
                // } else {
                //   // loggy.warning("unable to capture");
                // }
              },
            ),
            Align(
              alignment: AlignmentDirectional.topStart,
              child: Container(
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.primaryContainer,
                  borderRadius: BorderRadius.circular(1000),
                ),
                margin: const EdgeInsets.all(8),
                child: IconButton(
                  onPressed: () => context.pop(),
                  icon: Icon(Icons.close, color: Theme.of(context).colorScheme.onPrimaryContainer),
                  splashRadius: 24,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
